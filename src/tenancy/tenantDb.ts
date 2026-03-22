import { PrismaClient } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";
import { withSchemaInDatabaseUrl } from "./schema";

const tenantClients = new Map<string, PrismaClient>();

export async function resolveTenantSchemaName(guildId: string): Promise<string> {
  const tenant = await prisma.guildTenant.findUnique({ where: { guildId } });
  if (!tenant || !tenant.isProvisioned) {
    throw new Error("Guild is not provisioned. Run /tenant-setup first.");
  }

  return tenant.schemaName;
}

export async function getTenantPrisma(guildId: string): Promise<PrismaClient> {
  const schemaName = await resolveTenantSchemaName(guildId);
  const cached = tenantClients.get(schemaName);
  if (cached) {
    return cached;
  }

  const tenantUrl = withSchemaInDatabaseUrl(env.DATABASE_URL, schemaName);
  const tenantClient = new PrismaClient({
    datasources: {
      db: {
        url: tenantUrl,
      },
    },
  });

  tenantClients.set(schemaName, tenantClient);
  return tenantClient;
}

export async function disconnectTenantClients(): Promise<void> {
  await Promise.all(Array.from(tenantClients.values()).map((client) => client.$disconnect()));
  tenantClients.clear();
}
