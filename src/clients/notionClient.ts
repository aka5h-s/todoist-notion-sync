import { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  CreatePageParameters,
  PageObjectResponse,
  QueryDatabaseParameters,
  UpdatePageParameters
} from "@notionhq/client/build/src/api-endpoints.js";
import { env } from "../config/env.js";
import type { NotionTaskPage, SyncTask, TaskStatus } from "../types/domain.js";
import { isoNow, toNotionDate } from "../utils/date.js";
import { withRetry } from "../utils/retry.js";
import { getDueDate, mapPriority } from "../services/mappers.js";
import { buildTaskPageBlocks } from "../services/notionBlocks.js";
import { NotionFileUploadClient } from "./notionFileUploadClient.js";
import { logger } from "../utils/logger.js";
import { calculateTaskSyncHash } from "../services/syncHash.js";

const pageSize = 100;

export class NotionClient {
  private readonly notion: Client;
  private readonly fileUploads: NotionFileUploadClient;

  public constructor(fileUploads = new NotionFileUploadClient()) {
    this.notion = new Client({
      auth: env.NOTION_API_TOKEN
    });
    this.fileUploads = fileUploads;
  }

  public async listSyncedPages(databaseId: string): Promise<NotionTaskPage[]> {
    const pages: NotionTaskPage[] = [];
    let startCursor: string | undefined;

    do {
      const response = await withRetry(
        async () =>
          this.notion.databases.query({
            database_id: databaseId,
            page_size: pageSize,
            start_cursor: startCursor,
            filter: {
              property: "Source",
              select: {
                equals: "Todoist"
              }
            }
          } satisfies QueryDatabaseParameters),
        { operation: "notion:listSyncedPages" }
      );

      for (const result of response.results) {
        if (!isPageObject(result)) {
          continue;
        }

        const todoistId = getTextProperty(result, "Todoist ID");
        if (!todoistId) {
          continue;
        }

        pages.push({
          pageId: result.id,
          todoistId,
          status: getSelectProperty(result, "Status") ?? "Active",
          syncHash: getTextProperty(result, "Sync Hash") ?? undefined
        });
      }

      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);

    return pages;
  }

  public async upsertTask(databaseId: string, task: SyncTask): Promise<"created" | "updated" | "skipped"> {
    const existing = await this.findTaskPage(databaseId, task.id);
    const properties = taskProperties(task);
    const syncHash = calculateTaskSyncHash(task);

    if (existing?.syncHash === syncHash) {
      return "skipped";
    }

    properties["Sync Hash"] = {
      rich_text: [
        {
          text: {
            content: syncHash
          }
        }
      ]
    };

    const pageBlocks = buildTaskPageBlocks(await this.prepareImageAttachments(task));

    if (existing) {
      await this.updateTaskPage(existing.pageId, properties, pageBlocks);
      return "updated";
    }

    await this.createTaskPage(databaseId, properties, pageBlocks);
    return "created";
  }

  public async markDeleted(pageId: string): Promise<void> {
    await withRetry(
      async () =>
        this.notion.pages.update({
          page_id: pageId,
          properties: {
            Status: {
              select: {
                name: "Deleted"
              }
            },
            "Last Synced": {
              date: {
                start: isoNow()
              }
            }
          }
        } satisfies UpdatePageParameters),
      { operation: "notion:markDeleted" }
    );
  }

  private async findTaskPage(databaseId: string, todoistId: string): Promise<NotionTaskPage | null> {
    const response = await withRetry(
      async () =>
        this.notion.databases.query({
          database_id: databaseId,
          page_size: 1,
          filter: {
            property: "Todoist ID",
            rich_text: {
              equals: todoistId
            }
          }
        } satisfies QueryDatabaseParameters),
      { operation: "notion:findTaskPage" }
    );

    const first = response.results.find(isPageObject);
    if (!first) {
      return null;
    }

    return {
      pageId: first.id,
      todoistId,
      status: getSelectProperty(first, "Status") ?? "Active",
      syncHash: getTextProperty(first, "Sync Hash") ?? undefined
    };
  }

  private async createTaskPage(
    databaseId: string,
    properties: CreatePageParameters["properties"],
    children: BlockObjectRequest[]
  ): Promise<void> {
    const [firstChunk, ...remainingChunks] = chunkBlocks(children, pageSize);

    const page = await withRetry(
      async () =>
        this.notion.pages.create({
          parent: {
            database_id: databaseId
          },
          properties,
          children: firstChunk
        } satisfies CreatePageParameters),
      { operation: "notion:createTaskPage" }
    );

    await this.appendBlockChunks(page.id, remainingChunks);
  }

  private async updateTaskPage(
    pageId: string,
    properties: UpdatePageParameters["properties"],
    children: BlockObjectRequest[]
  ): Promise<void> {
    await withRetry(
      async () =>
        this.notion.pages.update({
          page_id: pageId,
          properties
        } satisfies UpdatePageParameters),
      { operation: "notion:updateTaskPage" }
    );

    await this.clearPageContent(pageId);
    await this.appendBlockChunks(pageId, chunkBlocks(children, pageSize));
  }

  private async clearPageContent(pageId: string): Promise<void> {
    let startCursor: string | undefined;

    do {
      const response = await withRetry(
        async () =>
          this.notion.blocks.children.list({
            block_id: pageId,
            page_size: pageSize,
            start_cursor: startCursor
          }),
        { operation: "notion:listPageBlocks" }
      );

      for (const block of response.results) {
        await withRetry(
          async () =>
            this.notion.blocks.update({
              block_id: block.id,
              archived: true
            }),
          { operation: "notion:archiveBlock" }
        );
      }

      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);
  }

  private async appendBlockChunks(blockId: string, chunks: BlockObjectRequest[][]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.length === 0) {
        continue;
      }

      await withRetry(
        async () =>
          this.notion.blocks.children.append({
            block_id: blockId,
            children: chunk
          }),
        { operation: "notion:appendBlocks" }
      );
    }
  }

  private async prepareImageAttachments(task: SyncTask): Promise<SyncTask> {
    return {
      ...task,
      comments: await Promise.all(task.comments.map((comment) => this.prepareCommentAttachment(task.id, comment))),
      subtasks: await Promise.all(task.subtasks.map((subtask) => this.prepareImageAttachments(subtask)))
    };
  }

  private async prepareCommentAttachment(
    taskId: string,
    comment: SyncTask["comments"][number]
  ): Promise<SyncTask["comments"][number]> {
    const attachment = comment.attachment;
    if (!attachment?.fileUrl || !isImageAttachment(attachment.contentType)) {
      return comment;
    }

    try {
      const notionFileUploadId = await this.fileUploads.uploadAttachment(attachment);
      return {
        ...comment,
        attachment: {
          ...attachment,
          notionFileUploadId
        }
      };
    } catch (error) {
      logger.warn({ error, todoistId: taskId, fileName: attachment.fileName }, "image upload failed");
      return {
        ...comment,
        attachment: {
          ...attachment,
          uploadError: "Image upload failed; keeping source link."
        }
      };
    }
  }
}

function isImageAttachment(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().startsWith("image/") ?? false;
}

function taskProperties(task: SyncTask): CreatePageParameters["properties"] {
  return {
    Task: {
      title: [
        {
          text: {
            content: task.content
          }
        }
      ]
    },
    "Todoist ID": {
      rich_text: [
        {
          text: {
            content: task.id
          }
        }
      ]
    },
    Status: {
      select: {
        name: task.status
      }
    },
    Labels: {
      multi_select: task.labels.map((label) => ({ name: label }))
    },
    Priority: {
      select: {
        name: mapPriority(task.priority)
      }
    },
    "Due Date": {
      date: toNotionDate(getDueDate(task))
    },
    "Created Date": {
      date: toNotionDate(task.createdAt)
    },
    "Completed Date": {
      date: toNotionDate(task.completedAt)
    },
    "Last Updated": {
      date: toNotionDate(task.updatedAt)
    },
    "Last Synced": {
      date: {
        start: isoNow()
      }
    },
    Description: {
      rich_text: [
        {
          text: {
            content: task.description.slice(0, 2000)
          }
        }
      ]
    },
    Source: {
      select: {
        name: "Todoist"
      }
    }
  };
}

function chunkBlocks(blocks: BlockObjectRequest[], size: number): BlockObjectRequest[][] {
  const chunks: BlockObjectRequest[][] = [];
  for (let index = 0; index < blocks.length; index += size) {
    chunks.push(blocks.slice(index, index + size));
  }
  return chunks;
}

function isPageObject(value: unknown): value is PageObjectResponse {
  return typeof value === "object" && value !== null && "properties" in value && "id" in value;
}

function getTextProperty(page: PageObjectResponse, propertyName: string): string | null {
  const property = page.properties[propertyName];
  if (!property) {
    return null;
  }

  if (property.type === "rich_text") {
    return property.rich_text.map((item) => item.plain_text).join("");
  }

  if (property.type === "title") {
    return property.title.map((item) => item.plain_text).join("");
  }

  return null;
}

function getSelectProperty(page: PageObjectResponse, propertyName: string): TaskStatus | null {
  const property = page.properties[propertyName];
  if (!property || property.type !== "select") {
    return null;
  }

  const name = property.select?.name;
  return name === "Active" || name === "Completed" || name === "Deleted" ? name : null;
}
