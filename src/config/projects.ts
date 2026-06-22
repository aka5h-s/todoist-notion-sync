import { env } from "./env.js";
import type { ProjectConfig } from "../types/domain.js";

export const projectConfigs: ProjectConfig[] = [
  {
    name: "Work",
    notionDatabaseId: env.WORK_DATABASE_ID
  },
  {
    name: "Personal",
    notionDatabaseId: env.PERSONAL_DATABASE_ID
  }
];
