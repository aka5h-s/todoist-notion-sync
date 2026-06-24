import "dotenv/config";
import { z } from "zod";

function extractDatabaseId(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  const clean = trimmed.replace(/-/g, "");
  if (/^[a-fA-F0-9]{32}$/.test(clean)) {
    return clean;
  }
  const match = trimmed.match(/\/([a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12})(?:\?|$)/);
  if (match) {
    return match[1].replace(/-/g, "");
  }
  const matchNoSlash = trimmed.match(/([a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12})/);
  if (matchNoSlash) {
    return matchNoSlash[1].replace(/-/g, "");
  }
  return clean;
}

const tokenSchema = z.string().min(1).transform((val) => val.trim().replace(/^["']|["']$/g, ""));
const databaseIdSchema = z.string().min(1).transform((val) => extractDatabaseId(val));
const databaseIdOptionalSchema = z.string().optional().transform((val) => val ? extractDatabaseId(val) : undefined);

const envSchema = z.object({
  TODOIST_API_TOKEN: tokenSchema,
  NOTION_API_TOKEN: tokenSchema,
  WORK_DATABASE_ID: databaseIdSchema,
  PERSONAL_DATABASE_ID: databaseIdSchema,
  SYNC_STATE_DATABASE_ID: databaseIdOptionalSchema,
  LOG_LEVEL: z.string().default("info"),
  COMPLETED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90),
  DISPLAY_TIME_ZONE: z.string().default("Asia/Kolkata"),
  MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024)
});

export const env = envSchema.parse(process.env);
