import cron from "node-cron";
import { Client, Colors, EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { durationToHuman, formatDate, formatRange } from "../utils/time";

function toDateTime(date: Date): DateTime {
  return DateTime.fromJSDate(date).setZone(env.TIMEZONE);
}

async function autoClockOut(client: Client): Promise<void> {
  const openEntries = await prisma.timeEntry.findMany({
    where: { status: "OPEN" },
    include: { employee: true }
  });

  if (openEntries.length === 0) {
    return;
  }

  const now = DateTime.now().setZone(env.TIMEZONE);
  const clockOutAt = now.startOf("day").toJSDate();

  for (const entry of openEntries) {
    const durationMinutes = Math.max(1, Math.round((clockOutAt.getTime() - entry.clockInAt.getTime()) / 60000));

    await prisma.timeEntry.update({
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
        { name: "Interval", value: formatRange(entry.clockInAt, clockOutAt, env.TIMEZONE), inline: false },
        { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
      )
      .setTimestamp();

    const archiveChannel = await client.channels.fetch(env.TIMESHEET_ARCHIVE_CHANNEL_ID);
    if (archiveChannel && archiveChannel.isTextBased() && !archiveChannel.isDMBased()) {
      await archiveChannel.send({ embeds: [logEmbed] });
    }
  }
}

async function dailySummary(client: Client): Promise<void> {
  const now = DateTime.now().setZone(env.TIMEZONE);
  const yesterdayStart = now.minus({ days: 1 }).startOf("day");
  const yesterdayEnd = now.minus({ days: 1 }).endOf("day");

  const entries = await prisma.timeEntry.findMany({
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
    .setFooter({ text: `Data: ${formatDate(yesterdayStart.toJSDate(), env.TIMEZONE)}` })
    .setTimestamp();

  const summaryChannel = await client.channels.fetch(env.TIMESHEET_SUMMARY_CHANNEL_ID);
  if (summaryChannel && summaryChannel.isTextBased() && !summaryChannel.isDMBased()) {
    await summaryChannel.send({ embeds: [summaryEmbed] });
  }
}

export function startTimesheetScheduler(client: Client): void {
  cron.schedule("0 0 * * *", async () => {
    await autoClockOut(client);
    await dailySummary(client);
  }, { timezone: env.TIMEZONE });
}
