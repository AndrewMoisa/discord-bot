import { ButtonInteraction, ChatInputCommandInteraction, Client, GuildMember, ModalSubmitInteraction } from "discord.js";
import { env } from "../env";
import { isManager } from "../utils/permissions";
import { handleCvCommand, handleCvModalSubmit, handleHireButton } from "./handlers/cv";
import { handleRefreshTimesheetPanelCommand, handleSetupTimesheetCommand, handleTimesheetButton } from "./handlers/timesheet";
import { requireGuildMember } from "./utils";

export async function handleChatCommand(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this command.", ephemeral: true });
    return;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  const managerAllowed = isManager(member, env.managerRoleIds);

  if (!managerAllowed) {
    await interaction.reply({ content: "You are not allowed to use this command.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "cv") {
    await handleCvCommand(interaction);
    return;
  }

  if (interaction.commandName === "setup-timesheet") {
    await handleSetupTimesheetCommand(interaction);
    return;
  }

  if (interaction.commandName === "refresh-timesheet") {
    await handleRefreshTimesheetPanelCommand(_client, interaction);
  }
}

export async function handleButton(client: Client, interaction: ButtonInteraction): Promise<void> {
  if (await handleHireButton(client, interaction)) {
    return;
  }

  await handleTimesheetButton(client, interaction);
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await handleCvModalSubmit(interaction);
}
