export type ProjectName = "Work" | "Personal";

export type TaskStatus = "Active" | "Completed" | "Deleted";

export type NotionPriority = "Critical" | "High" | "Medium" | "Low";

export interface ProjectConfig {
  name: ProjectName;
  notionDatabaseId: string;
}

export interface TodoistProject {
  id: string;
  name: string;
}

export interface TodoistDue {
  date: string;
  datetime?: string | null | undefined;
  timezone?: string | null | undefined;
  string?: string | null | undefined;
  isRecurring?: boolean | null | undefined;
}

export interface TodoistTask {
  id: string;
  projectId: string;
  sectionId?: string | null | undefined;
  parentId?: string | null | undefined;
  order: number;
  content: string;
  description: string;
  labels: string[];
  priority: number;
  due?: TodoistDue | null | undefined;
  url?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
  isCompleted: boolean;
  status: TaskStatus;
}

export interface TodoistCommentAttachment {
  fileName?: string | undefined;
  fileUrl?: string | undefined;
  contentType?: string | undefined;
  notionFileUploadId?: string | undefined;
  uploadError?: string | undefined;
}

export interface TodoistComment {
  id: string;
  taskId: string;
  content: string;
  postedAt?: string | undefined;
  author?: string | undefined;
  attachment?: TodoistCommentAttachment | undefined;
}

export interface SyncTask extends TodoistTask {
  comments: TodoistComment[];
  subtasks: SyncTask[];
}

export interface NotionTaskPage {
  pageId: string;
  todoistId: string;
  status: TaskStatus;
  syncHash?: string | undefined;
  dueDate?: string | null | undefined;
}

export interface SyncStats {
  created: number;
  updated: number;
  completed: number;
  deleted: number;
  skipped: number;
  failed: number;
}

export interface TodoistSyncState {
  syncToken: string;
  projects: TodoistProject[];
  tasks: TodoistTask[];
  comments: TodoistComment[];
  updatedAt?: string | undefined;
}
