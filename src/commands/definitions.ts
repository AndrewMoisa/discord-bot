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

export const timesheetEditCommand = new SlashCommandBuilder()
  .setName("timesheet-edit")
  .setDescription("Edit a time entry for an employee (manager only)")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The employee whose entry to edit")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("date")
      .setDescription("Date of the entry (dd.MM.yyyy). Defaults to today.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("clock-in")
      .setDescription("New clock-in time (HH:mm)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("clock-out")
      .setDescription("New clock-out time (HH:mm)")
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("delete")
      .setDescription("Delete the entry instead of editing it")
      .setRequired(false)
  );

export const timesheetViewCommand = new SlashCommandBuilder()
  .setName("timesheet")
  .setDescription("View timesheet entries for an employee")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The employee to view (defaults to yourself)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("Time period to view")
      .setRequired(false)
      .addChoices(
        { name: "Today", value: "today" },
        { name: "This Week", value: "week" },
        { name: "This Month", value: "month" }
      )
  );

export const deactivateCommand = new SlashCommandBuilder()
  .setName("deactivate")
  .setDescription("Deactivate an employee and remove their role (manager only)")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The employee to deactivate")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for deactivation")
      .setRequired(false)
  );

export const commandDefinitions = [
  cvCommand,
  setupTimesheetCommand,
  refreshTimesheetCommand,
  timesheetEditCommand,
  timesheetViewCommand,
  deactivateCommand,
].map((command) => command.toJSON());
