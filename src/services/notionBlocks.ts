import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import type { SyncTask, TodoistCommentAttachment } from "../types/domain.js";
import { formatDisplayDate } from "../utils/date.js";
import { getDueDate, mapPriority } from "./mappers.js";

const maxRichTextLength = 1900;

export function buildTaskPageBlocks(task: SyncTask): BlockObjectRequest[] {
  return [
    heading("Description"),
    ...paragraphs(task.description || "No description."),
    heading("Comments"),
    ...commentBlocks(task),
    heading("Subtasks"),
    ...subtaskBlocks(task.subtasks),
    heading("Attachments"),
    paragraph("Attachments are shown with their comments.")
  ];
}

function heading(text: string): BlockObjectRequest {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: richText(text)
    }
  };
}

function paragraph(text: string): BlockObjectRequest {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(text)
    }
  };
}

function paragraphs(text: string): BlockObjectRequest[] {
  const chunks = chunkText(text, maxRichTextLength);
  return chunks.length > 0 ? chunks.map((chunk) => paragraph(chunk)) : [paragraph("")];
}

function commentBlocks(task: SyncTask): BlockObjectRequest[] {
  const seen = new Set<string>();
  const comments = task.comments.filter((comment) => {
    if (seen.has(comment.id)) {
      return false;
    }
    seen.add(comment.id);
    return true;
  });

  if (comments.length === 0) {
    return [paragraph("No comments.")];
  }

  return comments.flatMap((comment) => {
    const timestamp = formatDisplayDate(comment.postedAt);
    const prefix = timestamp ? `${timestamp} - ` : "";
    const content = cleanCommentContent(comment.content);
    const hasText = content.length > 0;
    const blocks = hasText ? paragraphs(`${prefix}${content}`) : [];

    if (!comment.attachment) {
      return blocks.length > 0 ? blocks : paragraphs(`${prefix}Empty comment`);
    }

    if (blocks.length === 0 && timestamp) {
      return [paragraph(timestamp), ...commentAttachmentBlocks(comment.attachment)];
    }

    return [...blocks, ...commentAttachmentBlocks(comment.attachment)];
  });
}

function commentAttachmentBlocks(attachment: TodoistCommentAttachment): BlockObjectRequest[] {
  if (attachment.notionFileUploadId && isImageAttachment(attachment.contentType)) {
    return [notionUploadedImageBlock(attachment.notionFileUploadId)];
  }

  const name = attachment.fileName ?? "Attachment";
  const url = attachment.fileUrl;
  const warning = attachment.uploadError ? ` (${attachment.uploadError})` : "";

  if (!url) {
    return paragraphs(`${name}${warning}`);
  }

  return [
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `${name}${warning}`,
              link: {
                url
              }
            }
          }
        ]
      }
    }
  ];
}

function cleanCommentContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.toLowerCase() === "(attachment)" ? "" : trimmed;
}

function subtaskBlocks(tasks: SyncTask[]): BlockObjectRequest[] {
  if (tasks.length === 0) {
    return [paragraph("No subtasks.")];
  }

  return subtaskLines(tasks, 0).flatMap((line) => paragraphs(line));
}

function subtaskLines(tasks: SyncTask[], level: number): string[] {
  return tasks.flatMap((task) => {
    const line = subtaskLine(task, level);
    return [line, ...subtaskLines(task.subtasks, level + 1)];
  });
}

function subtaskLine(task: SyncTask, level: number): string {
  const status = task.isCompleted || task.status === "Completed" ? "✓" : "☐";
  const due = getDueDate(task) ? ` | due ${getDueDate(task)}` : "";
  const priority = ` | ${mapPriority(task.priority)}`;
  const indent = "  ".repeat(level);

  return `${indent}${status} ${task.content}${due}${priority}`;
}

function richText(text: string): Array<{ type: "text"; text: { content: string } }> {
  return [
    {
      type: "text",
      text: {
        content: text.slice(0, 2000)
      }
    }
  ];
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function notionUploadedImageBlock(fileUploadId: string): BlockObjectRequest {
  return {
    object: "block",
    type: "image",
    image: {
      type: "file_upload",
      file_upload: {
        id: fileUploadId
      }
    }
  } as unknown as BlockObjectRequest;
}

function isImageAttachment(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().startsWith("image/") ?? false;
}
