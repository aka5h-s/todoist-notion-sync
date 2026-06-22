import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import type { SyncTask, TodoistCommentAttachment } from "../types/domain.js";
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
    ...attachmentBlocks(task)
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
    const timestamp = comment.postedAt ?? "unknown time";
    const author = comment.author ? ` by ${comment.author}` : "";
    return paragraphs(`[${timestamp}]${author}: ${comment.content || "(attachment only)"}`);
  });
}

function attachmentBlocks(task: SyncTask): BlockObjectRequest[] {
  const attachments = task.comments
    .map((comment) => comment.attachment)
    .filter((attachment): attachment is TodoistCommentAttachment => Boolean(attachment?.fileUrl));

  const unique = new Map<string, TodoistCommentAttachment>();
  for (const attachment of attachments) {
    if (attachment.fileUrl) {
      unique.set(attachment.fileUrl, attachment);
    }
  }

  if (unique.size === 0) {
    return [paragraph("No attachments.")];
  }

  const blocks: BlockObjectRequest[] = [];
  for (const attachment of unique.values()) {
    const name = attachment.fileName ?? "Untitled attachment";
    const type = attachment.contentType ?? "unknown content type";
    const url = attachment.fileUrl ?? "";
    blocks.push(...paragraphs(`${name} | ${type} | ${url}`));

    if (isEmbeddableImage(type, url)) {
      blocks.push({
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: {
            url
          }
        }
      });
    }
  }

  return blocks;
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

function isEmbeddableImage(contentType: string, url: string): boolean {
  return contentType.toLowerCase().startsWith("image/") && url.length <= 2000;
}
