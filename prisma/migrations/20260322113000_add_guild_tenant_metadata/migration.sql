-- CreateTable
CREATE TABLE "GuildTenant" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "isProvisioned" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildTenantId" TEXT NOT NULL,
    "employeeRoleId" TEXT NOT NULL,
    "cvChannelId" TEXT NOT NULL,
    "cvApprovedChannelId" TEXT NOT NULL,
    "timesheetChannelId" TEXT NOT NULL,
    "timesheetArchiveChannelId" TEXT NOT NULL,
    "timesheetSummaryChannelId" TEXT NOT NULL,
    "logChannelId" TEXT NOT NULL,
    "managerRoleIds" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupAudit" (
    "id" TEXT NOT NULL,
    "guildTenantId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildTenant_guildId_key" ON "GuildTenant"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildTenant_schemaName_key" ON "GuildTenant"("schemaName");

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildTenantId_key" ON "GuildConfig"("guildTenantId");

-- CreateIndex
CREATE INDEX "SetupAudit_guildTenantId_createdAt_idx" ON "SetupAudit"("guildTenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuildConfig" ADD CONSTRAINT "GuildConfig_guildTenantId_fkey" FOREIGN KEY ("guildTenantId") REFERENCES "GuildTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupAudit" ADD CONSTRAINT "SetupAudit_guildTenantId_fkey" FOREIGN KEY ("guildTenantId") REFERENCES "GuildTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
