import { GuildConfig } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";
import { buildTenantSchemaName } from "./schema";
import { GuildConfigInput, GuildRuntimeConfig } from "./types";

function parseManagerRoleIds(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDefaultConfigOrThrow(): GuildConfigInput {
  if (!env.DEFAULT_EMPLOYEE_ROLE_ID || !env.DEFAULT_CV_CHANNEL_ID || !env.DEFAULT_CV_APPROVED_CHANNEL_ID ||
    !env.DEFAULT_TIMESHEET_CHANNEL_ID || !env.DEFAULT_TIMESHEET_ARCHIVE_CHANNEL_ID || !env.DEFAULT_TIMESHEET_SUMMARY_CHANNEL_ID ||
    !env.DEFAULT_LOG_CHANNEL_ID) {
    throw new Error("Guild config missing and DEFAULT_* fallback values are not fully configured.");
  }

  return {
    employeeRoleId: env.DEFAULT_EMPLOYEE_ROLE_ID,
    cvChannelId: env.DEFAULT_CV_CHANNEL_ID,
    cvApprovedChannelId: env.DEFAULT_CV_APPROVED_CHANNEL_ID,
    timesheetChannelId: env.DEFAULT_TIMESHEET_CHANNEL_ID,
    timesheetArchiveChannelId: env.DEFAULT_TIMESHEET_ARCHIVE_CHANNEL_ID,
    timesheetSummaryChannelId: env.DEFAULT_TIMESHEET_SUMMARY_CHANNEL_ID,
    logChannelId: env.DEFAULT_LOG_CHANNEL_ID,
    managerRoleIds: env.defaultManagerRoleIds,
    timezone: env.DEFAULT_TIMEZONE,
  };
}

function toRuntimeConfig(guildId: string, guildName: string, schemaName: string, isProvisioned: boolean, config: GuildConfig): GuildRuntimeConfig {
  return {
    guildId,
    guildName,
    schemaName,
    isProvisioned,
    employeeRoleId: config.employeeRoleId,
    cvChannelId: config.cvChannelId,
    cvApprovedChannelId: config.cvApprovedChannelId,
    timesheetChannelId: config.timesheetChannelId,
    timesheetArchiveChannelId: config.timesheetArchiveChannelId,
    timesheetSummaryChannelId: config.timesheetSummaryChannelId,
    logChannelId: config.logChannelId,
    managerRoleIds: config.managerRoleIds,
    timezone: config.timezone,
  };
}

export function runtimeConfigToInput(config: GuildRuntimeConfig): GuildConfigInput {
  return {
    employeeRoleId: config.employeeRoleId,
    cvChannelId: config.cvChannelId,
    cvApprovedChannelId: config.cvApprovedChannelId,
    timesheetChannelId: config.timesheetChannelId,
    timesheetArchiveChannelId: config.timesheetArchiveChannelId,
    timesheetSummaryChannelId: config.timesheetSummaryChannelId,
    logChannelId: config.logChannelId,
    managerRoleIds: config.managerRoleIds,
    timezone: config.timezone,
  };
}

export async function getGuildRuntimeConfig(guildId: string): Promise<GuildRuntimeConfig> {
  const tenant = await prisma.guildTenant.findUnique({
    where: { guildId },
    include: { config: true },
  });

  if (!tenant || !tenant.config) {
    throw new Error("Guild has no configuration. Run /tenant-setup first.");
  }

  return toRuntimeConfig(tenant.guildId, tenant.guildName, tenant.schemaName, tenant.isProvisioned, tenant.config);
}

export async function upsertGuildConfig(guildId: string, guildName: string, configInput?: GuildConfigInput): Promise<GuildRuntimeConfig> {
  const config = configInput ?? getDefaultConfigOrThrow();
  const schemaName = buildTenantSchemaName(guildId);

  const tenant = await prisma.guildTenant.upsert({
    where: { guildId },
    create: {
      guildId,
      guildName,
      schemaName,
      isProvisioned: false,
      config: {
        create: config,
      },
    },
    update: {
      guildName,
      config: {
        upsert: {
          create: config,
          update: config,
        },
      },
    },
    include: { config: true },
  });

  if (!tenant.config) {
    throw new Error("Failed to persist guild config");
  }

  return toRuntimeConfig(tenant.guildId, tenant.guildName, tenant.schemaName, tenant.isProvisioned, tenant.config);
}

export function parseManagerRoleInput(raw: string): string[] {
  return parseManagerRoleIds(raw);
}

export async function resolveProvisionConfig(guildId: string, guildName: string, input?: GuildConfigInput): Promise<GuildConfigInput> {
  if (input) {
    return input;
  }

  try {
    const runtimeConfig = await getGuildRuntimeConfig(guildId);
    return runtimeConfigToInput(runtimeConfig);
  } catch (_error) {
    const runtimeConfig = await upsertGuildConfig(guildId, guildName);
    return runtimeConfigToInput(runtimeConfig);
  }
}
