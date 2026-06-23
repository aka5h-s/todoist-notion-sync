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
    ...subtaskBlocks(task.subtasks)
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
  const comments = uniqueComments(task.comments);
  if (comments.length === 0) {
    return [paragraph("No comments.")];
  }

  return comments.flatMap((comment) => renderComment(comment, 0));
}

function subtaskBlocks(tasks: SyncTask[]): BlockObjectRequest[] {
  if (tasks.length === 0) {
    return [paragraph("No subtasks.")];
  }

  return tasks.map((task) => subtaskToggleBlock(task));
}

function subtaskToggleBlock(task: SyncTask): BlockObjectRequest {
  const children = [
    ...uniqueComments(task.comments).flatMap((comment) => renderComment(comment, 0)),
    ...task.subtasks.map((subtask) => subtaskToggleBlock(subtask))
  ];

  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: richText(subtaskLine(task)),
      children: children.length > 0 ? children : [paragraph("No details.")]
    }
  } as unknown as BlockObjectRequest;
}

function subtaskLine(task: SyncTask): string {
  const status = task.isCompleted || task.status === "Completed" ? "✓" : "☐";
  const due = getDueDate(task) ? ` | due ${getDueDate(task)}` : "";
  const mappedPriority = mapPriority(task.priority);
  const priority = mappedPriority === "Low" ? "" : ` | ${mappedPriority}`;

  return `${status} ${task.content}${due}${priority}`;
}

function renderComment(comment: SyncTask["comments"][number], level: number): BlockObjectRequest[] {
  const indent = "  ".repeat(level);
  const timestamp = formatDisplayDate(comment.postedAt);
  const content = cleanCommentContent(comment.content);
  const blocks = [
    ...(timestamp ? paragraphs(`${indent}Comment · ${timestamp}`) : []),
    ...(content ? paragraphs(`${indent}${content}`) : [])
  ];

  if (!comment.attachment) {
    return blocks.length > 0 ? blocks : paragraphs(`${indent}Empty comment`);
  }

  if (blocks.length === 0 && timestamp) {
    return [paragraph(`${indent}${timestamp}`), ...commentAttachmentBlocks(comment.attachment)];
  }

  return [...blocks, ...commentAttachmentBlocks(comment.attachment)];
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

function uniqueComments(comments: SyncTask["comments"]): SyncTask["comments"] {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    if (seen.has(comment.id)) {
      return false;
    }
    seen.add(comment.id);
    return true;
  });
}

function cleanCommentContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.toLowerCase() === "(attachment)" ? "" : trimmed;
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
