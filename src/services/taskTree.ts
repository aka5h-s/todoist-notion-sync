import type { SyncTask, TodoistComment, TodoistTask } from "../types/domain.js";

export function buildTopLevelTasks(
  tasks: TodoistTask[],
  commentsByTaskId: Map<string, TodoistComment[]>
): SyncTask[] {
  const byId = new Map<string, SyncTask>();

  for (const task of tasks) {
    byId.set(task.id, {
      ...task,
      comments: commentsByTaskId.get(task.id) ?? [],
      subtasks: []
    });
  }

  const roots: SyncTask[] = [];

  for (const task of byId.values()) {
    if (task.parentId && byId.has(task.parentId)) {
      byId.get(task.parentId)?.subtasks.push(task);
    } else {
      roots.push(task);
    }
  }

  sortRecursively(roots);
  return roots.filter((task) => !task.parentId);
}

function sortRecursively(tasks: SyncTask[]): void {
  tasks.sort((left, right) => left.order - right.order || left.content.localeCompare(right.content));

  for (const task of tasks) {
    sortRecursively(task.subtasks);
  }
}
