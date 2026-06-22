import axios, { type AxiosInstance } from "axios";
import FormData from "form-data";
import { z } from "zod";
import { env } from "../config/env.js";
import type { TodoistCommentAttachment } from "../types/domain.js";
import { withRetry } from "../utils/retry.js";

const createUploadSchema = z.object({
  id: z.string(),
  upload_url: z.string()
});

export class NotionFileUploadClient {
  private readonly notionHttp: AxiosInstance;
  private readonly downloadHttp: AxiosInstance;

  public constructor() {
    this.notionHttp = axios.create({
      baseURL: "https://api.notion.com/v1",
      timeout: 60_000,
      headers: {
        Authorization: `Bearer ${env.NOTION_API_TOKEN}`,
        "Notion-Version": "2026-03-11"
      }
    });

    this.downloadHttp = axios.create({
      timeout: 60_000,
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${env.TODOIST_API_TOKEN}`
      }
    });
  }

  public async uploadAttachment(attachment: TodoistCommentAttachment): Promise<string> {
    if (!attachment.fileUrl) {
      throw new Error("attachment does not include a file URL");
    }

    const fileName = attachment.fileName ?? "todoist-attachment";
    const contentType = attachment.contentType ?? "application/octet-stream";
    const fileBuffer = await this.downloadAttachment(attachment.fileUrl);
    if (fileBuffer.byteLength > env.MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`attachment is larger than MAX_IMAGE_UPLOAD_BYTES (${fileBuffer.byteLength} bytes)`);
    }

    const upload = await withRetry(
      async () => {
        const response = await this.notionHttp.post<unknown>("/file_uploads", {
          mode: "single_part",
          filename: fileName,
          content_type: contentType
        });
        return createUploadSchema.parse(response.data);
      },
      { operation: "notion:createFileUpload" }
    );

    const form = new FormData();
    form.append("file", fileBuffer, {
      filename: fileName,
      contentType
    });

    await withRetry(
      async () => {
        await axios.post(upload.upload_url, form, {
          timeout: 60_000,
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${env.NOTION_API_TOKEN}`,
            "Notion-Version": "2026-03-11"
          }
        });
      },
      { operation: "notion:sendFileUpload" }
    );

    return upload.id;
  }

  private async downloadAttachment(url: string): Promise<Buffer> {
    return withRetry(
      async () => {
        const response = await this.downloadHttp.get<ArrayBuffer>(url);
        return Buffer.from(response.data);
      },
      { operation: "todoist:downloadAttachment" }
    );
  }
}
