import type { NotionPriority, TodoistTask } from "../types/domain.js";

export function mapPriority(todoistPriority: number | undefined): NotionPriority {
  switch (todoistPriority) {
    case 4:
      return "Critical";
    case 3:
      return "High";
    case 2:
      return "Medium";
    case 1:
    default:
      return "Low";
  }
}

export function getDueDate(task: TodoistTask): string | null {
  return task.due?.datetime ?? task.due?.date ?? null;
}
