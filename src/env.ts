import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  APP_ID: z.string().min(1),
  GUILD_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  EMPLOYEE_ROLE_ID: z.string().min(1),
  CV_CHANNEL_ID: z.string().min(1),
  CV_APPROVED_CHANNEL_ID: z.string().min(1),
  TIMESHEET_CHANNEL_ID: z.string().min(1),
  TIMESHEET_ARCHIVE_CHANNEL_ID: z.string().min(1),
  TIMESHEET_SUMMARY_CHANNEL_ID: z.string().min(1),
  LOG_CHANNEL_ID: z.string().min(1),
  MANAGER_ROLE_IDS: z.string().min(1),
  TIMEZONE: z.string().default("Europe/Bucharest"),
  CLOCK_IN_START_HOUR: z.coerce.number().int().min(0).max(23).default(19),
  CLOCK_IN_START_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  CLOCK_IN_END_HOUR: z.coerce.number().int().min(0).max(23).default(23),
  CLOCK_IN_END_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  AUTO_CLOCK_OUT_HOUR: z.coerce.number().int().min(0).max(23).default(23),
  AUTO_CLOCK_OUT_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  DAILY_SUMMARY_HOUR: z.coerce.number().int().min(0).max(23).default(23),
  DAILY_SUMMARY_MINUTE: z.coerce.number().int().min(0).max(59).default(5)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment variables", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsedEnv.data,
  managerRoleIds: parsedEnv.data.MANAGER_ROLE_IDS.split(",").map((item) => item.trim()).filter(Boolean)
};
