import { projectConfigs } from "../config/projects.js";
import { env } from "../config/env.js";
import { NotionClient } from "../clients/notionClient.js";
import { NotionStateClient } from "../clients/notionStateClient.js";
import { TodoistClient } from "../clients/todoistClient.js";
import { TodoistSyncClient } from "../clients/todoistSyncClient.js";
import type { ProjectConfig, SyncStats, TodoistComment, TodoistSyncState, TodoistTask } from "../types/domain.js";
import { daysAgoIso, isoNow } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { buildTopLevelTasks } from "./taskTree.js";

export class SyncService {
  private readonly todoist: TodoistClient;
  private readonly todoistSync: TodoistSyncClient;
  private readonly notion: NotionClient;
  private readonly state: NotionStateClient;

  public constructor(
    todoist = new TodoistClient(),
    notion = new NotionClient(),
    todoistSync = new TodoistSyncClient(),
    state = new NotionStateClient()
  ) {
    this.todoist = todoist;
    this.notion = notion;
    this.todoistSync = todoistSync;
    this.state = state;
  }

  public async run(): Promise<SyncStats> {
    if (this.state.isEnabled()) {
      return this.runFromSyncApi();
    }

    logger.warn("SYNC_STATE_DATABASE_ID is not configured; using legacy REST sync fallback");
    return this.runFromRestApi();
  }

  private async runFromSyncApi(): Promise<SyncStats> {
    const stats = emptyStats();
    const previousState = await this.state.readState();
    const nextState = await this.todoistSync.sync(previousState);

    try {
      await this.syncSnapshot(nextState, stats);
      if (stats.failed > 0) {
        throw new Error(`sync had ${stats.failed} failed task operation(s)`);
      }
      await this.state.writeState(nextState);
    } catch (error) {
      logger.error({ error }, "sync snapshot failed; state token was not advanced");
      throw error;
    }

    return stats;
  }

  private async runFromRestApi(): Promise<SyncStats> {
    const stats = emptyStats();
    const projects = await this.todoist.getProjects();
    const commentsByTaskId = new Map<string, TodoistComment[]>();

    for (const config of projectConfigs) {
      const projectId = new Map(projects.map((project) => [project.name, project.id])).get(config.name);
      if (!projectId) {
        logger.warn({ projectName: config.name }, "todoist project was not found; skipping");
        stats.skipped += 1;
        continue;
      }

      const [activeTasks, completedTasks] = await Promise.all([
        this.todoist.getActiveTasks(projectId),
        this.todoist.getCompletedTasks(projectId, daysAgoIso(env.COMPLETED_LOOKBACK_DAYS), isoNow())
      ]);

      const tasks = [...activeTasks, ...completedTasks];
      for (const task of tasks) {
        commentsByTaskId.set(task.id, await this.safeGetComments(task.id));
      }

      await this.syncProjectTasks(config, tasks, commentsByTaskId, stats);
    }

    return stats;
  }

  private async syncSnapshot(state: TodoistSyncState, stats: SyncStats): Promise<void> {
    const projectIdByName = new Map(state.projects.map((project) => [project.name, project.id]));
    const commentsByTaskId = groupCommentsByTaskId(state.comments);

    for (const config of projectConfigs) {
      const projectId = projectIdByName.get(config.name);
      if (!projectId) {
        logger.warn({ projectName: config.name }, "todoist project was not found in sync snapshot; skipping");
        stats.skipped += 1;
        continue;
      }

      await this.syncProjectTasks(
        config,
        state.tasks.filter((task) => task.projectId === projectId),
        commentsByTaskId,
        stats
      );
    }
  }

  private async syncProjectTasks(
    config: ProjectConfig,
    tasks: TodoistTask[],
    commentsByTaskId: Map<string, TodoistComment[]>,
    stats: SyncStats
  ): Promise<void> {
    logger.info({ projectName: config.name, taskCount: tasks.length }, "syncing project");

    const existingPages = await this.notion.listSyncedPages(config.notionDatabaseId);
    const topLevelTasks = buildTopLevelTasks(tasks, commentsByTaskId);
    const sourceTaskIds = new Set(topLevelTasks.map((task) => task.id));

    for (const task of topLevelTasks) {
      try {
        const result = await this.notion.upsertTask(config.notionDatabaseId, task);
        if (result === "created") {
          stats.created += 1;
        } else if (result === "updated") {
          stats.updated += 1;
        } else {
          stats.skipped += 1;
        }

        if (task.status === "Completed") {
          stats.completed += 1;
        }
      } catch (error) {
        stats.failed += 1;
        logger.error({ error, todoistId: task.id, projectName: config.name }, "failed to sync task");
      }
    }

    for (const page of existingPages) {
      if (page.status !== "Active" || sourceTaskIds.has(page.todoistId)) {
        continue;
      }

      try {
        await this.notion.markDeleted(page.pageId);
        stats.deleted += 1;
      } catch (error) {
        stats.failed += 1;
        logger.error({ error, todoistId: page.todoistId, projectName: config.name }, "failed to mark task deleted");
      }
    }
  }

  private async safeGetComments(taskId: string): Promise<TodoistComment[]> {
    try {
      return await this.todoist.getComments(taskId);
    } catch (error) {
      logger.warn({ error, todoistId: taskId }, "could not fetch comments for task");
      return [];
    }
  }
}

function groupCommentsByTaskId(comments: TodoistComment[]): Map<string, TodoistComment[]> {
  const grouped = new Map<string, TodoistComment[]>();

  for (const comment of comments) {
    grouped.set(comment.taskId, [...(grouped.get(comment.taskId) ?? []), comment]);
  }

  return grouped;
}

function emptyStats(): SyncStats {
  return {
    created: 0,
    updated: 0,
    completed: 0,
    deleted: 0,
    skipped: 0,
    failed: 0
  };
}
