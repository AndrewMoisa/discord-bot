import { prisma } from "../db";
import { buildTenantSchemaName, TENANT_SCHEMA_VERSION } from "./schema";
import { buildTenantSchemaSql } from "./tenantSql";
import { GuildConfigInput } from "./types";

export async function provisionGuildTenant(params: {
  guildId: string;
  guildName: string;
  actorUserId: string;
  config: GuildConfigInput;
}): Promise<void> {
  const { guildId, guildName, actorUserId, config } = params;
  const schemaName = buildTenantSchemaName(guildId);

  const tenant = await prisma.guildTenant.upsert({
    where: { guildId },
    create: {
      guildId,
      guildName,
      schemaName,
      isProvisioned: false,
      schemaVersion: 0,
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
  });

  try {
    const statements = buildTenantSchemaSql(schemaName);
    for (const sql of statements) {
      await prisma.$executeRawUnsafe(sql);
    }

    await prisma.guildTenant.update({
      where: { id: tenant.id },
      data: {
        isProvisioned: true,
        schemaVersion: TENANT_SCHEMA_VERSION,
        lastError: null,
      },
    });

    await prisma.setupAudit.create({
      data: {
        guildTenantId: tenant.id,
        actorUserId,
        action: "provision",
        status: "success",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown setup error";

    await prisma.guildTenant.update({
      where: { id: tenant.id },
      data: {
        isProvisioned: false,
        lastError: message,
      },
    });

    await prisma.setupAudit.create({
      data: {
        guildTenantId: tenant.id,
        actorUserId,
        action: "provision",
        status: "error",
        details: message,
      },
    });

    throw error;
  }
}
