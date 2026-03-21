import { SlashCommandBuilder } from "discord.js";

export const hireCommand = new SlashCommandBuilder()
  .setName("hire")
  .setDescription("Create a hiring request for an employee")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The Discord member to hire")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("full_name")
      .setDescription("Employee full name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("position")
      .setDescription("Employee position")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("department")
      .setDescription("Employee department")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("notes")
      .setDescription("Optional manager notes")
      .setRequired(false)
  );

export const setupTimesheetCommand = new SlashCommandBuilder()
  .setName("setup-timesheet")
  .setDescription("Post the clock in/out panel in the timesheet channel");

export const commandDefinitions = [hireCommand, setupTimesheetCommand].map((command) => command.toJSON());
