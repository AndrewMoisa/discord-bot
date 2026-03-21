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
  LOG_CHANNEL_ID: z.string().min(1),
  MANAGER_ROLE_IDS: z.string().min(1),
  TIMEZONE: z.string().default("Europe/Bucharest")
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
