import { Client, Events, GatewayIntentBits, Interaction } from "discord.js";
import { registerGuildCommands } from "./commands/registerCommands";
import { startControlPanelServer } from "./controlPanel/server";
import { prisma } from "./db";
import { env } from "./env";
import { handleButton, handleChatCommand, handleModalSubmit } from "./interactions/handlers";
import { disconnectTenantClients } from "./tenancy/tenantDb";
import { startTimesheetScheduler } from "./timesheet/scheduler";

let controlPanelServer: { close: () => Promise<void> } | null = null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    await readyClient.guilds.fetch();
    const guildIds = readyClient.guilds.cache.map((guild) => guild.id);
    await registerGuildCommands(guildIds);
    console.log(`Guild commands registered successfully for ${guildIds.length} guild(s)`);
  } catch (error) {
    console.error("Failed to register slash commands", error);
  }

  controlPanelServer = startControlPanelServer(readyClient);
  startTimesheetScheduler(client);
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await registerGuildCommands([guild.id]);
    console.log(`Commands registered for new guild ${guild.id}`);
  } catch (error) {
    console.error(`Failed to register commands for guild ${guild.id}`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatCommand(client, interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(client, interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error("Interaction handling error", error);

    if (interaction.isRepliable()) {
      const payload = { content: "An unexpected error occurred.", ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  }
});

async function main(): Promise<void> {
  await client.login(env.BOT_TOKEN);
}

main().catch(async (error) => {
  console.error("Fatal startup error", error);
  await prisma.$disconnect();
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down`);
  client.destroy();
  if (controlPanelServer) {
    await controlPanelServer.close();
  }
  await disconnectTenantClients();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
