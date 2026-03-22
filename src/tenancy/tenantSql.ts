import { quoteSchemaIdentifier } from "./schema";

export function buildTenantSchemaSql(schemaName: string): string[] {
  const schema = quoteSchemaIdentifier(schemaName);

  return [
    `CREATE SCHEMA IF NOT EXISTS ${schema};`,
    `DO $$ BEGIN
      CREATE TYPE ${schema}.\"HireRequestStatus\" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,
    `DO $$ BEGIN
      CREATE TYPE ${schema}.\"TimeEntryStatus\" AS ENUM ('OPEN', 'CLOSED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS ${schema}.\"Employee\" (
      \"id\" TEXT NOT NULL,
      \"discordUserId\" TEXT NOT NULL,
      \"displayName\" TEXT NOT NULL,
      \"position\" TEXT NOT NULL,
      \"department\" TEXT,
      \"notes\" TEXT,
      \"hiredById\" TEXT NOT NULL,
      \"hiredAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \"roleAssignedAt\" TIMESTAMP(3),
      \"isActive\" BOOLEAN NOT NULL DEFAULT true,
      \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \"updatedAt\" TIMESTAMP(3) NOT NULL,
      CONSTRAINT \"Employee_pkey\" PRIMARY KEY (\"id\")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS \"Employee_discordUserId_key\" ON ${schema}.\"Employee\"(\"discordUserId\");`,
    `CREATE INDEX IF NOT EXISTS \"Employee_discordUserId_isActive_idx\" ON ${schema}.\"Employee\"(\"discordUserId\", \"isActive\");`,
    `CREATE TABLE IF NOT EXISTS ${schema}.\"HireRequest\" (
      \"id\" TEXT NOT NULL,
      \"requesterId\" TEXT NOT NULL,
      \"targetUserId\" TEXT NOT NULL,
      \"fullName\" TEXT NOT NULL,
      \"cnp\" TEXT NOT NULL DEFAULT '',
      \"phone\" TEXT NOT NULL DEFAULT '',
      \"idCardUrl\" TEXT NOT NULL DEFAULT '',
      \"referredBy\" TEXT NOT NULL DEFAULT '',
      \"status\" ${schema}.\"HireRequestStatus\" NOT NULL DEFAULT 'PENDING',
      \"reviewedById\" TEXT,
      \"reviewedAt\" TIMESTAMP(3),
      \"reviewReason\" TEXT,
      \"messageId\" TEXT,
      \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \"updatedAt\" TIMESTAMP(3) NOT NULL,
      CONSTRAINT \"HireRequest_pkey\" PRIMARY KEY (\"id\")
    );`,
    `CREATE INDEX IF NOT EXISTS \"HireRequest_status_createdAt_idx\" ON ${schema}.\"HireRequest\"(\"status\", \"createdAt\");`,
    `CREATE INDEX IF NOT EXISTS \"HireRequest_targetUserId_idx\" ON ${schema}.\"HireRequest\"(\"targetUserId\");`,
    `CREATE TABLE IF NOT EXISTS ${schema}.\"TimeEntry\" (
      \"id\" TEXT NOT NULL,
      \"employeeId\" TEXT NOT NULL,
      \"clockInAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \"clockOutAt\" TIMESTAMP(3),
      \"durationMinutes\" INTEGER,
      \"status\" ${schema}.\"TimeEntryStatus\" NOT NULL DEFAULT 'OPEN',
      \"sourceMessageId\" TEXT,
      \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \"updatedAt\" TIMESTAMP(3) NOT NULL,
      CONSTRAINT \"TimeEntry_pkey\" PRIMARY KEY (\"id\")
    );`,
    `CREATE INDEX IF NOT EXISTS \"TimeEntry_employeeId_status_idx\" ON ${schema}.\"TimeEntry\"(\"employeeId\", \"status\");`,
    `CREATE INDEX IF NOT EXISTS \"TimeEntry_clockInAt_idx\" ON ${schema}.\"TimeEntry\"(\"clockInAt\");`,
    `DO $$ BEGIN
      ALTER TABLE ${schema}.\"TimeEntry\"
      ADD CONSTRAINT \"TimeEntry_employeeId_fkey\"
      FOREIGN KEY (\"employeeId\") REFERENCES ${schema}.\"Employee\"(\"id\") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`
  ];
}
