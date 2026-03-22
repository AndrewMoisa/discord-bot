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

export const tenantSetupCommand = new SlashCommandBuilder()
  .setName("tenant-setup")
  .setDescription("Provision this server tenant schema and save server configuration")
  .addStringOption((option) => option.setName("employee_role_id").setDescription("Employee role id").setRequired(true))
  .addStringOption((option) => option.setName("cv_channel_id").setDescription("CV channel id").setRequired(true))
  .addStringOption((option) => option.setName("cv_approved_channel_id").setDescription("Approved CV channel id").setRequired(true))
  .addStringOption((option) => option.setName("timesheet_channel_id").setDescription("Timesheet panel channel id").setRequired(true))
  .addStringOption((option) => option.setName("timesheet_archive_channel_id").setDescription("Timesheet archive channel id").setRequired(true))
  .addStringOption((option) => option.setName("timesheet_summary_channel_id").setDescription("Timesheet summary channel id").setRequired(true))
  .addStringOption((option) => option.setName("log_channel_id").setDescription("Audit log channel id").setRequired(true))
  .addStringOption((option) => option.setName("manager_role_ids").setDescription("Comma separated manager role ids").setRequired(true))
  .addStringOption((option) => option.setName("timezone").setDescription("IANA timezone, e.g. Europe/Bucharest").setRequired(false));

export const tenantStatusCommand = new SlashCommandBuilder()
  .setName("tenant-status")
  .setDescription("Show this server tenant setup status");

export const commandDefinitions = [
  cvCommand,
  setupTimesheetCommand,
  tenantSetupCommand,
  tenantStatusCommand,
].map((command) => command.toJSON());
