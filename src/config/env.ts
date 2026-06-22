import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TODOIST_API_TOKEN: z.string().min(1),
  NOTION_API_TOKEN: z.string().min(1),
  WORK_DATABASE_ID: z.string().min(1),
  PERSONAL_DATABASE_ID: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
  COMPLETED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90)
});

export const env = envSchema.parse(process.env);
