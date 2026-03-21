import { Client, Events, GatewayIntentBits, Interaction } from "discord.js";
import { registerGuildCommands } from "./commands/registerCommands";
import { prisma } from "./db";
import { env } from "./env";
import { handleButton, handleChatCommand } from "./interactions/handlers";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    await registerGuildCommands();
    console.log("Guild commands registered successfully");
  } catch (error) {
    console.error("Failed to register slash commands", error);
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
  await client.login(env.DISCORD_TOKEN);
}

main().catch(async (error) => {
  console.error("Fatal startup error", error);
  await prisma.$disconnect();
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down`);
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
