export const TENANT_SCHEMA_VERSION = 1;

export function buildTenantSchemaName(guildId: string): string {
  if (!/^\d{5,30}$/.test(guildId)) {
    throw new Error("Invalid guild id format");
  }

  return `g_${guildId}`;
}

export function quoteSchemaIdentifier(schemaName: string): string {
  if (!/^g_[0-9]{5,30}$/.test(schemaName)) {
    throw new Error("Invalid schema name");
  }

  return `\"${schemaName}\"`;
}

export function withSchemaInDatabaseUrl(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}
