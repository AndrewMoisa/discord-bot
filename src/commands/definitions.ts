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

export const refreshTimesheetCommand = new SlashCommandBuilder()
  .setName("refresh-timesheet")
  .setDescription("Refresh the existing timesheet panel message");

export const commandDefinitions = [cvCommand, setupTimesheetCommand, refreshTimesheetCommand].map((command) => command.toJSON());
