import { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  PageObjectResponse,
  QueryDatabaseParameters
} from "@notionhq/client/build/src/api-endpoints.js";
import { env } from "../config/env.js";
import type { TodoistSyncState } from "../types/domain.js";
import { isoNow } from "../utils/date.js";
import { withRetry } from "../utils/retry.js";

const stateKey = "todoist-sync-state";
const pageSize = 100;
const chunkLength = 1800;

export class NotionStateClient {
  private readonly notion: Client;

  public constructor() {
    this.notion = new Client({
      auth: env.NOTION_API_TOKEN,
      fetch: (url, options) => globalThis.fetch(url, options)
    });
  }

  public isEnabled(): boolean {
    return Boolean(env.SYNC_STATE_DATABASE_ID);
  }

  public async readState(): Promise<TodoistSyncState | null> {
    if (!env.SYNC_STATE_DATABASE_ID) {
      return null;
    }

    const page = await this.findStatePage();
    if (!page) {
      return null;
    }

    const body = await this.readPageText(page.id);
    if (!body.trim()) {
      return null;
    }

    return JSON.parse(body) as TodoistSyncState;
  }

  public async writeState(state: TodoistSyncState): Promise<void> {
    if (!env.SYNC_STATE_DATABASE_ID) {
      return;
    }

    const page = await this.findStatePage();
    const payload = JSON.stringify({
      ...state,
      updatedAt: isoNow()
    });

    if (page) {
      await this.clearPageContent(page.id);
      await this.appendChunks(page.id, payload);
      await withRetry(
        async () =>
          this.notion.pages.update({
            page_id: page.id,
            properties: {
              "Updated At": {
                date: {
                  start: isoNow()
                }
              }
            }
          }),
        { operation: "notion:updateStatePage" }
      );
      return;
    }

    const created = await withRetry(
      async () =>
        this.notion.pages.create({
          parent: {
            database_id: env.SYNC_STATE_DATABASE_ID ?? ""
          },
          properties: {
            Key: {
              title: [
                {
                  text: {
                    content: stateKey
                  }
                }
              ]
            },
            "Updated At": {
              date: {
                start: isoNow()
              }
            }
          }
        }),
      { operation: "notion:createStatePage" }
    );

    await this.appendChunks(created.id, payload);
  }

  private async findStatePage(): Promise<PageObjectResponse | null> {
    if (!env.SYNC_STATE_DATABASE_ID) {
      return null;
    }

    const response = await withRetry(
      async () =>
        this.notion.databases.query({
          database_id: env.SYNC_STATE_DATABASE_ID ?? "",
          page_size: 1,
          filter: {
            property: "Key",
            title: {
              equals: stateKey
            }
          }
        } satisfies QueryDatabaseParameters),
      { operation: "notion:findStatePage" }
    );

    return response.results.find(isPageObject) ?? null;
  }

  private async readPageText(pageId: string): Promise<string> {
    const chunks: string[] = [];
    let startCursor: string | undefined;

    do {
      const response = await withRetry(
        async () =>
          this.notion.blocks.children.list({
            block_id: pageId,
            page_size: pageSize,
            start_cursor: startCursor
          }),
        { operation: "notion:readStateBlocks" }
      );

      for (const block of response.results) {
        if ("type" in block && block.type === "paragraph") {
          chunks.push(block.paragraph.rich_text.map((text) => text.plain_text).join(""));
        }
      }

      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);

    return chunks.join("");
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
        { operation: "notion:listStateBlocks" }
      );

      for (const block of response.results) {
        await withRetry(
          async () =>
            this.notion.blocks.update({
              block_id: block.id,
              archived: true
            }),
          { operation: "notion:archiveStateBlock" }
        );
      }

      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);
  }

  private async appendChunks(pageId: string, payload: string): Promise<void> {
    const blocks: BlockObjectRequest[] = [];
    for (let index = 0; index < payload.length; index += chunkLength) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: payload.slice(index, index + chunkLength)
              }
            }
          ]
        }
      });
    }

    for (let index = 0; index < blocks.length; index += pageSize) {
      await withRetry(
        async () =>
          this.notion.blocks.children.append({
            block_id: pageId,
            children: blocks.slice(index, index + pageSize)
          }),
        { operation: "notion:appendStateBlocks" }
      );
    }
  }
}

function isPageObject(value: unknown): value is PageObjectResponse {
  return typeof value === "object" && value !== null && "properties" in value && "id" in value;
}
