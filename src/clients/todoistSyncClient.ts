import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { env } from "../config/env.js";
import type {
  TodoistComment,
  TodoistCommentAttachment,
  TodoistProject,
  TodoistSyncState,
  TodoistTask
} from "../types/domain.js";
import { isoNow } from "../utils/date.js";
import { withRetry } from "../utils/retry.js";

const projectSchema = z
  .object({
    id: z.coerce.string(),
    name: z.string().nullable().optional(),
    is_deleted: z.boolean().nullable().optional(),
    is_archived: z.boolean().nullable().optional()
  })
  .passthrough();

const dueSchema = z
  .object({
    date: z.string().nullable().optional(),
    datetime: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
    string: z.string().nullable().optional()
  })
  .passthrough();

const itemSchema = z
  .object({
    id: z.coerce.string(),
    project_id: z.coerce.string().nullable().optional(),
    section_id: z.coerce.string().nullable().optional(),
    parent_id: z.coerce.string().nullable().optional(),
    child_order: z.number().int().nullable().optional().transform((val) => val ?? 0),
    content: z.string().nullable().optional().transform((val) => val ?? ""),
    description: z.string().nullable().optional(),
    labels: z.array(z.string()).nullable().optional().transform((val) => val ?? []),
    priority: z.number().int().nullable().optional().transform((val) => val ?? 1),
    due: dueSchema.nullable().optional(),
    url: z.string().nullable().optional(),
    added_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    checked: z.boolean().nullable().optional(),
    is_deleted: z.boolean().nullable().optional()
  })
  .passthrough();

const attachmentSchema = z
  .object({
    file_name: z.string().nullable().optional(),
    file_url: z.string().nullable().optional(),
    file_type: z.string().nullable().optional(),
    resource_type: z.string().nullable().optional()
  })
  .passthrough();

const noteSchema = z
  .object({
    id: z.coerce.string(),
    item_id: z.coerce.string().nullable().optional(),
    task_id: z.coerce.string().nullable().optional(),
    content: z.string().nullable().optional().transform((val) => val ?? ""),
    posted_at: z.string().nullable().optional(),
    posted_uid: z.union([z.string(), z.number()]).nullable().optional(),
    file_attachment: attachmentSchema.nullable().optional(),
    is_deleted: z.boolean().nullable().optional()
  })
  .passthrough();

const syncResponseSchema = z
  .object({
    sync_token: z.string(),
    full_sync: z.boolean().optional(),
    projects: z.array(z.unknown()).nullable().optional().transform((val) => val ?? []),
    items: z.array(z.unknown()).nullable().optional().transform((val) => val ?? []),
    notes: z.array(z.unknown()).nullable().optional().transform((val) => val ?? [])
  })
  .passthrough();

export class TodoistSyncClient {
  private readonly http: AxiosInstance;

  public constructor() {
    this.http = axios.create({
      baseURL: "https://api.todoist.com/api/v1",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${env.TODOIST_API_TOKEN}`
      }
    });
  }

  public async sync(previousState: TodoistSyncState | null): Promise<TodoistSyncState> {
    const response = await withRetry(
      async () => {
        const body = new URLSearchParams({
          sync_token: previousState?.syncToken ?? "*",
          resource_types: JSON.stringify(["projects", "items", "notes"])
        });

        const result = await this.http.post<unknown>("/sync", body, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        });

        return syncResponseSchema.parse(result.data);
      },
      { operation: "todoist:sync" }
    );

    const baseState: TodoistSyncState =
      response.full_sync || !previousState
        ? emptyState()
        : previousState;

    return {
      syncToken: response.sync_token,
      projects: mergeProjects(baseState.projects, response.projects),
      tasks: mergeTasks(baseState.tasks, response.items),
      comments: mergeComments(baseState.comments, response.notes),
      updatedAt: isoNow()
    };
  }
}

function emptyState(): TodoistSyncState {
  return {
    syncToken: "*",
    projects: [],
    tasks: [],
    comments: []
  };
}

function mergeProjects(existing: TodoistProject[], updates: unknown[]): TodoistProject[] {
  const byId = new Map(existing.map((project) => [project.id, project]));

  for (const raw of updates) {
    const project = projectSchema.parse(raw);
    if (project.is_deleted || project.is_archived) {
      byId.delete(project.id);
      continue;
    }

    byId.set(project.id, {
      id: project.id,
      name: project.name ?? ""
    });
  }

  return [...byId.values()];
}

function mergeTasks(existing: TodoistTask[], updates: unknown[]): TodoistTask[] {
  const byId = new Map(existing.map((task) => [task.id, task]));

  for (const raw of updates) {
    const item = itemSchema.parse(raw);
    if (item.is_deleted) {
      byId.delete(item.id);
      continue;
    }

    byId.set(item.id, {
      id: item.id,
      projectId: item.project_id ?? "",
      sectionId: item.section_id,
      parentId: item.parent_id,
      order: item.child_order,
      content: item.content,
      description: item.description ?? "",
      labels: item.labels,
      priority: item.priority,
      due: item.due,
      url: item.url ?? undefined,
      createdAt: item.added_at ?? item.created_at ?? undefined,
      updatedAt: item.updated_at ?? undefined,
      completedAt: item.completed_at ?? undefined,
      isCompleted: item.checked === true,
      status: item.checked === true ? "Completed" : "Active"
    });
  }

  return [...byId.values()];
}

function mergeComments(existing: TodoistComment[], updates: unknown[]): TodoistComment[] {
  const byId = new Map(existing.map((comment) => [comment.id, comment]));

  for (const raw of updates) {
    const note = noteSchema.parse(raw);
    const taskId = note.item_id ?? note.task_id;
    if (!taskId) {
      continue;
    }

    if (note.is_deleted) {
      byId.delete(note.id);
      continue;
    }

    byId.set(note.id, {
      id: note.id,
      taskId,
      content: note.content,
      postedAt: note.posted_at ?? undefined,
      author: note.posted_uid ? String(note.posted_uid) : undefined,
      attachment: toAttachment(note.file_attachment)
    });
  }

  return [...byId.values()];
}

function toAttachment(raw: z.infer<typeof attachmentSchema> | null | undefined): TodoistCommentAttachment | undefined {
  if (!raw) {
    return undefined;
  }

  return {
    fileName: raw.file_name ?? undefined,
    fileUrl: raw.file_url ?? undefined,
    contentType: raw.file_type ?? raw.resource_type ?? undefined
  };
}
