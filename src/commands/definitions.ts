import { SlashCommandBuilder } from "discord.js";

export const cvCommand = new SlashCommandBuilder()
  .setName("cv")
  .setDescription("Create a CV submission for a member")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The Discord member for the CV")
      .setRequired(true)
  );

export const setupTimesheetCommand = new SlashCommandBuilder()
  .setName("setup-timesheet")
  .setDescription("Post the clock in/out panel in the timesheet channel");

export const commandDefinitions = [cvCommand, setupTimesheetCommand].map((command) => command.toJSON());
