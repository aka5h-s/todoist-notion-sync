import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { env } from "../config/env.js";
import type {
  TodoistComment,
  TodoistCommentAttachment,
  TodoistDue,
  TodoistProject,
  TodoistTask
} from "../types/domain.js";
import { withRetry } from "../utils/retry.js";

const paginatedSchema = z.object({
  results: z.array(z.unknown()).default([]),
  next_cursor: z.string().nullable().optional()
});

const completedPaginatedSchema = z.object({
  items: z.array(z.unknown()).default([]),
  next_cursor: z.string().nullable().optional()
});

const projectSchema = z.object({
  id: z.coerce.string(),
  name: z.string()
});

const dueSchema = z
  .object({
    date: z.string(),
    datetime: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
    string: z.string().nullable().optional()
  })
  .passthrough();

const taskSchema = z
  .object({
    id: z.coerce.string(),
    project_id: z.coerce.string(),
    section_id: z.coerce.string().nullable().optional(),
    parent_id: z.coerce.string().nullable().optional(),
    child_order: z.number().int().default(0),
    content: z.string(),
    description: z.string().nullable().optional(),
    labels: z.array(z.string()).default([]),
    priority: z.number().int().default(1),
    due: dueSchema.nullable().optional(),
    url: z.string().optional(),
    added_at: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    completed_at: z.string().nullable().optional(),
    checked: z.boolean().optional()
  })
  .passthrough();

const attachmentSchema = z
  .object({
    file_name: z.string().optional(),
    file_url: z.string().optional(),
    file_type: z.string().optional(),
    resource_type: z.string().optional()
  })
  .passthrough();

const commentSchema = z
  .object({
    id: z.coerce.string(),
    task_id: z.coerce.string().optional(),
    item_id: z.coerce.string().optional(),
    content: z.string().default(""),
    posted_at: z.string().optional(),
    posted_uid: z.union([z.string(), z.number()]).optional(),
    file_attachment: attachmentSchema.nullable().optional(),
    is_deleted: z.boolean().optional()
  })
  .passthrough();

export class TodoistClient {
  private readonly http: AxiosInstance;

  public constructor() {
    this.http = axios.create({
      baseURL: "https://api.todoist.com/api/v1",
      timeout: 20_000,
      headers: {
        Authorization: `Bearer ${env.TODOIST_API_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  }

  public async getProjects(): Promise<TodoistProject[]> {
    const raw = await this.getPaginated("/projects", {});
    return raw.map((project) => projectSchema.parse(project));
  }

  public async getActiveTasks(projectId: string): Promise<TodoistTask[]> {
    const raw = await this.getPaginated("/tasks", { project_id: projectId, limit: 200 });
    return raw.map((task) => this.toTask(task, false));
  }

  public async getCompletedTasks(projectId: string, since: string, until: string): Promise<TodoistTask[]> {
    const raw = await this.getCompletedPaginated("/tasks/completed/by_completion_date", {
      project_id: projectId,
      since,
      until,
      limit: 200
    });

    return raw.map((task) => this.toTask(task, true));
  }

  public async getComments(taskId: string): Promise<TodoistComment[]> {
    const raw = await this.getPaginated("/comments", { task_id: taskId, limit: 200 });
    return raw
      .map((comment) => this.toComment(comment, taskId))
      .filter((comment): comment is TodoistComment => comment !== null);
  }

  private async getPaginated(path: string, params: Record<string, string | number>): Promise<unknown[]> {
    const output: unknown[] = [];
    let cursor: string | undefined;

    do {
      const data = await withRetry(
        async () => {
          const response = await this.http.get<unknown>(path, {
            params: { ...params, cursor }
          });
          return paginatedSchema.parse(response.data);
        },
        { operation: `todoist:${path}` }
      );

      output.push(...data.results);
      cursor = data.next_cursor ?? undefined;
    } while (cursor);

    return output;
  }

  private async getCompletedPaginated(
    path: string,
    params: Record<string, string | number>
  ): Promise<unknown[]> {
    const output: unknown[] = [];
    let cursor: string | undefined;

    do {
      const data = await withRetry(
        async () => {
          const response = await this.http.get<unknown>(path, {
            params: { ...params, cursor }
          });
          return completedPaginatedSchema.parse(response.data);
        },
        { operation: `todoist:${path}` }
      );

      output.push(...data.items);
      cursor = data.next_cursor ?? undefined;
    } while (cursor);

    return output;
  }

  private toTask(raw: unknown, completed: boolean): TodoistTask {
    const task = taskSchema.parse(raw);

    return {
      id: task.id,
      projectId: task.project_id,
      sectionId: task.section_id,
      parentId: task.parent_id,
      order: task.child_order,
      content: task.content,
      description: task.description ?? "",
      labels: task.labels,
      priority: task.priority,
      due: task.due as TodoistDue | null | undefined,
      url: task.url,
      createdAt: task.added_at ?? task.created_at,
      updatedAt: task.updated_at,
      completedAt: task.completed_at ?? undefined,
      isCompleted: completed || task.checked === true,
      status: completed || task.checked === true ? "Completed" : "Active"
    };
  }

  private toComment(raw: unknown, fallbackTaskId: string): TodoistComment | null {
    const comment = commentSchema.parse(raw);
    if (comment.is_deleted) {
      return null;
    }

    const attachment: TodoistCommentAttachment | undefined = comment.file_attachment
      ? {
          fileName: comment.file_attachment.file_name,
          fileUrl: comment.file_attachment.file_url,
          contentType: comment.file_attachment.file_type ?? comment.file_attachment.resource_type
        }
      : undefined;

    return {
      id: comment.id,
      taskId: comment.task_id ?? comment.item_id ?? fallbackTaskId,
      content: comment.content,
      postedAt: comment.posted_at,
      author: comment.posted_uid ? String(comment.posted_uid) : undefined,
      attachment
    };
  }
}
