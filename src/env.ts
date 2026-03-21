import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  CLIENT_ID: z.string().min(1),
  GUILD_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ROLE_EMPLOYEE_ID: z.string().min(1),
  CHANNEL_HIRING_ID: z.string().min(1),
  CHANNEL_TIMESHEET_ID: z.string().min(1),
  CHANNEL_LOGS_ID: z.string().min(1),
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
