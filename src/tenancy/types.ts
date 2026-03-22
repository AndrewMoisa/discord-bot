export type GuildConfigInput = {
  employeeRoleId: string;
  cvChannelId: string;
  cvApprovedChannelId: string;
  timesheetChannelId: string;
  timesheetArchiveChannelId: string;
  timesheetSummaryChannelId: string;
  logChannelId: string;
  managerRoleIds: string[];
  timezone: string;
};

export type GuildRuntimeConfig = GuildConfigInput & {
  guildId: string;
  guildName: string;
  schemaName: string;
  isProvisioned: boolean;
};
