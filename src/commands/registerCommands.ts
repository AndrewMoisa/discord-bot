import { REST, Routes } from "discord.js";
import { env } from "../env";
import { commandDefinitions } from "./definitions";

export async function registerGuildCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), {
    body: commandDefinitions
  });
}
