import { REST, Routes } from "discord.js";
import { env } from "../env";
import { commandDefinitions } from "./definitions";

export async function registerGuildCommands(guildIds: string[]): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.BOT_TOKEN);

  await Promise.all(
    guildIds.map((guildId) =>
      rest.put(Routes.applicationGuildCommands(env.APP_ID, guildId), {
        body: commandDefinitions,
      })
    )
  );
}
