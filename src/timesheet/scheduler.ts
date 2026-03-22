import cron from "node-cron";
import { Client, Colors, EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { getTenantPrisma } from "../tenancy/tenantDb";
import { durationToHuman, formatDate, formatRange } from "../utils/time";

async function autoClockOut(client: Client, guildId: string, timezone: string, archiveChannelId: string): Promise<void> {
  const tenantPrisma = await getTenantPrisma(guildId);
  const openEntries = await tenantPrisma.timeEntry.findMany({
    where: { status: "OPEN" },
    include: { employee: true }
  });

  if (openEntries.length === 0) {
    return;
  }

  const now = DateTime.now().setZone(timezone);
  const clockOutAt = now.startOf("day").toJSDate();

  for (const entry of openEntries) {
    const durationMinutes = Math.max(1, Math.round((clockOutAt.getTime() - entry.clockInAt.getTime()) / 60000));

    await tenantPrisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        clockOutAt,
        durationMinutes,
        status: "CLOSED"
      }
    });

    const logEmbed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle("Auto Clock Out")
      .addFields(
        { name: "Employee", value: `<@${entry.employee.discordUserId}>`, inline: true },
        { name: "Interval", value: formatRange(entry.clockInAt, clockOutAt, timezone), inline: false },
        { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
      )
      .setTimestamp();

    const archiveChannel = await client.channels.fetch(archiveChannelId);
    if (archiveChannel && archiveChannel.isTextBased() && !archiveChannel.isDMBased()) {
      if (entry.sourceMessageId) {
        const existing = await archiveChannel.messages.fetch(entry.sourceMessageId).catch(() => null);
        if (existing) {
          await existing.edit({ embeds: [logEmbed] });
          continue;
        }
      }

      const created = await archiveChannel.send({ embeds: [logEmbed] });
      await tenantPrisma.timeEntry.update({
        where: { id: entry.id },
        data: { sourceMessageId: created.id }
      });
    }
  }
}

async function dailySummary(client: Client, guildId: string, timezone: string, summaryChannelId: string): Promise<void> {
  const tenantPrisma = await getTenantPrisma(guildId);
  const now = DateTime.now().setZone(timezone);
  const yesterdayStart = now.minus({ days: 1 }).startOf("day");
  const yesterdayEnd = now.minus({ days: 1 }).endOf("day");

  const entries = await tenantPrisma.timeEntry.findMany({
    where: {
      status: "CLOSED",
      clockOutAt: {
        gte: yesterdayStart.toJSDate(),
        lte: yesterdayEnd.toJSDate()
      }
    },
    include: { employee: true }
  });

  if (entries.length === 0) {
    return;
  }

  const totals = new Map<string, number>();
  for (const entry of entries) {
    const current = totals.get(entry.employee.discordUserId) ?? 0;
    totals.set(entry.employee.discordUserId, current + (entry.durationMinutes ?? 0));
  }

  const lines = Array.from(totals.entries()).map(
    ([discordUserId, minutes]) => `- <@${discordUserId}>: ${durationToHuman(minutes)} (${minutes} min)`
  );

  const summaryEmbed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("Daily Timesheet Summary")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Data: ${formatDate(yesterdayStart.toJSDate(), timezone)}` })
    .setTimestamp();

  const summaryChannel = await client.channels.fetch(summaryChannelId);
  if (summaryChannel && summaryChannel.isTextBased() && !summaryChannel.isDMBased()) {
    await summaryChannel.send({ embeds: [summaryEmbed] });
  }
}

async function weeklySummary(client: Client, guildId: string, timezone: string, summaryChannelId: string): Promise<void> {
  const tenantPrisma = await getTenantPrisma(guildId);
  const now = DateTime.now().setZone(timezone);
  const weekStart = now.startOf("week");
  const weekEnd = now.endOf("week");

  const entries = await tenantPrisma.timeEntry.findMany({
    where: {
      status: "CLOSED",
      clockOutAt: {
        gte: weekStart.toJSDate(),
        lte: weekEnd.toJSDate()
      }
    },
    include: { employee: true }
  });

  if (entries.length === 0) {
    return;
  }

  const totals = new Map<string, { name: string; minutes: number }>();
  for (const entry of entries) {
    const key = entry.employee.discordUserId;
    const current = totals.get(key) ?? { name: entry.employee.displayName, minutes: 0 };
    totals.set(key, { name: current.name, minutes: current.minutes + (entry.durationMinutes ?? 0) });
  }

  const lines = Array.from(totals.values()).map(
    (item) => `- ${item.name} -> ${durationToHuman(item.minutes)}`
  );

  const summaryEmbed = new EmbedBuilder()
    .setColor(Colors.DarkBlue)
    .setTitle("Weekly Timesheet Summary")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Saptamana: ${formatDate(weekStart.toJSDate(), timezone)} - ${formatDate(weekEnd.toJSDate(), timezone)}` })
    .setTimestamp();

  const summaryChannel = await client.channels.fetch(summaryChannelId);
  if (summaryChannel && summaryChannel.isTextBased() && !summaryChannel.isDMBased()) {
    await summaryChannel.send({ embeds: [summaryEmbed] });
  }
}

async function runForAllProvisionedGuilds(
  worker: (guildId: string, timezone: string, archiveChannelId: string, summaryChannelId: string) => Promise<void>
): Promise<void> {
  const tenants = await prisma.guildTenant.findMany({
    where: { isProvisioned: true },
    include: { config: true }
  });

  for (const tenant of tenants) {
    if (!tenant.config) {
      continue;
    }

    try {
      await worker(
        tenant.guildId,
        tenant.config.timezone,
        tenant.config.timesheetArchiveChannelId,
        tenant.config.timesheetSummaryChannelId
      );
    } catch (error) {
      console.error(`Scheduler failed for guild ${tenant.guildId}`, error);
    }
  }
}

export function startTimesheetScheduler(client: Client): void {
  cron.schedule("0 0 * * *", async () => {
    await runForAllProvisionedGuilds(async (guildId, timezone, archiveChannelId, summaryChannelId) => {
      await autoClockOut(client, guildId, timezone, archiveChannelId);
      await dailySummary(client, guildId, timezone, summaryChannelId);
    });
  });

  cron.schedule("0 19 * * 0", async () => {
    await runForAllProvisionedGuilds(async (guildId, timezone, _archiveChannelId, summaryChannelId) => {
      await weeklySummary(client, guildId, timezone, summaryChannelId);
    });
  });
}
