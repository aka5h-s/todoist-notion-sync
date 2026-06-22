import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TODOIST_API_TOKEN: z.string().min(1),
  NOTION_API_TOKEN: z.string().min(1),
  WORK_DATABASE_ID: z.string().min(1),
  PERSONAL_DATABASE_ID: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
  COMPLETED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90),
  DISPLAY_TIME_ZONE: z.string().default("Asia/Kolkata"),
  MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024)
});

export const env = envSchema.parse(process.env);
