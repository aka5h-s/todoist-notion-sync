import type { SyncTask } from "../types/domain.js";
import { stableHash } from "../utils/hash.js";

const syncHashVersion = "2026-06-23-subtask-toggles-v1";

export function calculateTaskSyncHash(task: SyncTask): string {
  return stableHash(toHashableTask(task));
}

function toHashableTask(task: SyncTask): unknown {
  return {
    syncHashVersion,
    id: task.id,
    content: task.content,
    description: task.description,
    labels: [...task.labels].sort(),
    priority: task.priority,
    due: task.due ?? null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    completedAt: task.completedAt ?? null,
    status: task.status,
    comments: task.comments
      .map((comment) => ({
        id: comment.id,
        content: comment.content,
        postedAt: comment.postedAt ?? null,
        attachment: comment.attachment
          ? {
              fileName: comment.attachment.fileName ?? null,
              fileUrl: comment.attachment.fileUrl ?? null,
              contentType: comment.attachment.contentType ?? null
            }
          : null
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    subtasks: task.subtasks.map((subtask) => toHashableTask(subtask))
  };
}
