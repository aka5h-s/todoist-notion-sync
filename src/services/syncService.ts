import { projectConfigs } from "../config/projects.js";
import { env } from "../config/env.js";
import { NotionClient } from "../clients/notionClient.js";
import { TodoistClient } from "../clients/todoistClient.js";
import type { ProjectConfig, SyncStats, TodoistComment, TodoistTask } from "../types/domain.js";
import { daysAgoIso, isoNow } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { buildTopLevelTasks } from "./taskTree.js";

export class SyncService {
  private readonly todoist: TodoistClient;
  private readonly notion: NotionClient;

  public constructor(todoist = new TodoistClient(), notion = new NotionClient()) {
    this.todoist = todoist;
    this.notion = notion;
  }

  public async run(): Promise<SyncStats> {
    const stats = emptyStats();
    const projects = await this.todoist.getProjects();
    const projectIdByName = new Map(projects.map((project) => [project.name, project.id]));

    for (const config of projectConfigs) {
      const projectId = projectIdByName.get(config.name);
      if (!projectId) {
        logger.warn({ projectName: config.name }, "todoist project was not found; skipping");
        stats.skipped += 1;
        continue;
      }

      await this.syncProject(config, projectId, stats);
    }

    return stats;
  }

  private async syncProject(config: ProjectConfig, projectId: string, stats: SyncStats): Promise<void> {
    logger.info({ projectName: config.name, projectId }, "syncing project");

    const [activeTasks, completedTasks, existingPages] = await Promise.all([
      this.todoist.getActiveTasks(projectId),
      this.todoist.getCompletedTasks(projectId, daysAgoIso(env.COMPLETED_LOOKBACK_DAYS), isoNow()),
      this.notion.listSyncedPages(config.notionDatabaseId)
    ]);

    const tasksById = new Map<string, TodoistTask>();
    for (const task of [...activeTasks, ...completedTasks]) {
      tasksById.set(task.id, task);
    }

    const commentsByTaskId = await this.fetchComments([...tasksById.values()]);
    const topLevelTasks = buildTopLevelTasks([...tasksById.values()], commentsByTaskId);
    const sourceTaskIds = new Set(topLevelTasks.map((task) => task.id));

    for (const task of topLevelTasks) {
      try {
        const result = await this.notion.upsertTask(config.notionDatabaseId, task);
        if (result === "created") {
          stats.created += 1;
        } else {
          stats.updated += 1;
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

  private async fetchComments(tasks: TodoistTask[]): Promise<Map<string, TodoistComment[]>> {
    const commentsByTaskId = new Map<string, TodoistComment[]>();

    for (const task of tasks) {
      try {
        commentsByTaskId.set(task.id, await this.todoist.getComments(task.id));
      } catch (error) {
        commentsByTaskId.set(task.id, []);
        logger.warn({ error, todoistId: task.id }, "could not fetch comments for task");
      }
    }

    return commentsByTaskId;
  }
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
