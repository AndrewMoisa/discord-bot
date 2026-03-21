import { REST, Routes } from "discord.js";
import { env } from "../env";
import { commandDefinitions } from "./definitions";

export async function registerGuildCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(env.APP_ID, env.GUILD_ID), {
    body: commandDefinitions
  });
}
