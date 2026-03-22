import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  APP_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  BOT_OWNER_IDS: z.string().min(1),
  CONTROL_PANEL_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  PANEL_API_TOKEN: z.string().optional(),
  PANEL_PROXY_SHARED_SECRET: z.string().optional(),
  PANEL_PROXY_ONLY: z.coerce.boolean().default(false),
  PANEL_ALLOWED_ORIGINS: z.string().optional(),
  DEFAULT_EMPLOYEE_ROLE_ID: z.string().optional(),
  DEFAULT_CV_CHANNEL_ID: z.string().optional(),
  DEFAULT_CV_APPROVED_CHANNEL_ID: z.string().optional(),
  DEFAULT_TIMESHEET_CHANNEL_ID: z.string().optional(),
  DEFAULT_TIMESHEET_ARCHIVE_CHANNEL_ID: z.string().optional(),
  DEFAULT_TIMESHEET_SUMMARY_CHANNEL_ID: z.string().optional(),
  DEFAULT_LOG_CHANNEL_ID: z.string().optional(),
  DEFAULT_MANAGER_ROLE_IDS: z.string().optional(),
  DEFAULT_TIMEZONE: z.string().default("Europe/Bucharest")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment variables", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsedEnv.data,
  ownerUserIds: parsedEnv.data.BOT_OWNER_IDS.split(",").map((item) => item.trim()).filter(Boolean),
  panelAllowedOrigins: (parsedEnv.data.PANEL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  defaultManagerRoleIds: (parsedEnv.data.DEFAULT_MANAGER_ROLE_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
};
