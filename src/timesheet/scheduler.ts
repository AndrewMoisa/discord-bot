import cron from "node-cron";
import { Client, Colors, EmbedBuilder } from "discord.js";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { asTextChannel } from "../interactions/utils";
import { updateTimesheetPanel } from "../interactions/handlers/timesheet";
import { durationToHuman, formatDate, formatRange } from "../utils/time";

function autoClockOutReason(): string {
  return "Inchidere automata la 23:00 (inchidere shop).";
}

async function notifyAutoClockOutUser(client: Client, discordUserId: string, entry: {
  clockInAt: Date;
  clockOutAt: Date;
  durationMinutes: number;
}, reason: string): Promise<void> {
  const user = await client.users.fetch(discordUserId).catch(() => null);
  if (!user) {
    return;
  }

  await user.send(
    `Pontajul tau a fost inchis automat.\n` +
    `Motiv: ${reason}\n` +
    `Interval: ${formatRange(entry.clockInAt, entry.clockOutAt, env.TIMEZONE)}\n` +
    `Total: ${durationToHuman(entry.durationMinutes)} (${entry.durationMinutes} min)`
  ).catch(() => null);
}

async function autoClockOut(client: Client): Promise<void> {
  const now = DateTime.now().setZone(env.TIMEZONE);
  let didCloseAny = false;

  const openEntries = await prisma.timeEntry.findMany({
    where: { status: "OPEN" as const },
    include: { employee: true },
    orderBy: { clockInAt: "asc" }
  });

  if (openEntries.length === 0) {
    return;
  }

  const clockOutAt = now.toJSDate();
  const reason = autoClockOutReason();

  for (const entry of openEntries) {
    const elapsedMs = Math.max(60000, clockOutAt.getTime() - entry.clockInAt.getTime());
    const durationMinutes = Math.round(elapsedMs / 60000);

    const closed = await prisma.timeEntry.updateMany({
      where: { id: entry.id, status: "OPEN" },
      data: {
        clockOutAt,
        durationMinutes,
        status: "CLOSED"
      }
    });

    if (closed.count === 0) {
      continue;
    }

    didCloseAny = true;

    const logEmbed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle("Auto Clock Out")
      .addFields(
        { name: "Employee", value: `<@${entry.employee.discordUserId}>`, inline: true },
        { name: "Motiv", value: reason, inline: false },
        { name: "Interval", value: formatRange(entry.clockInAt, clockOutAt, env.TIMEZONE), inline: false },
        { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
      )
      .setTimestamp();

    await notifyAutoClockOutUser(client, entry.employee.discordUserId, {
      clockInAt: entry.clockInAt,
      clockOutAt,
      durationMinutes
    }, reason);

    const archiveChannel = await client.channels.fetch(env.TIMESHEET_ARCHIVE_CHANNEL_ID);
    if (archiveChannel && archiveChannel.isTextBased() && !archiveChannel.isDMBased()) {
      if (entry.sourceMessageId) {
        const existing = await archiveChannel.messages.fetch(entry.sourceMessageId).catch(() => null);
        if (existing) {
          await existing.edit({ embeds: [logEmbed] });
          continue;
        }
      }

      const created = await archiveChannel.send({ embeds: [logEmbed] });
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: { sourceMessageId: created.id }
      });
    }
  }

  if (!didCloseAny) {
    console.info("Auto clock-out completed with no state changes; skipping panel refresh.");
    return;
  }

  const timesheetChannel = asTextChannel(await client.channels.fetch(env.TIMESHEET_CHANNEL_ID).catch(() => null));
  if (!timesheetChannel) {
    console.warn("Auto clock-out closed entries, but timesheet channel was unavailable for panel refresh.");
    return;
  }

  await updateTimesheetPanel(client, timesheetChannel).catch((error) => {
    console.error("Auto clock-out closed entries, but panel refresh failed.", error);
  });
}

async function reserveDailySummary(summaryDate: Date): Promise<boolean> {
  try {
    await prisma.dailySummaryRun.create({
      data: {
        summaryDate
      }
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }

    throw error;
  }
}

async function runScheduledJob(name: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (error) {
    console.error(`Scheduler job failed: ${name}`, error);
  }
}

async function dailySummary(client: Client): Promise<void> {
  const now = DateTime.now().setZone(env.TIMEZONE);
  const todayStart = now.startOf("day");
  const todayEnd = now.endOf("day");
  const summaryDate = todayStart.toUTC().toJSDate();

  const isReserved = await reserveDailySummary(summaryDate);
  if (!isReserved) {
    return;
  }

  try {
    const entries = await prisma.timeEntry.findMany({
      where: {
        status: "CLOSED",
        clockOutAt: {
          gte: todayStart.toJSDate(),
          lte: todayEnd.toJSDate()
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
      .setTitle("Raport Zilnic Pontaj")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Data: ${formatDate(todayStart.toJSDate(), env.TIMEZONE)} | Generat automat` })
      .setTimestamp();

    const summaryChannel = await client.channels.fetch(env.TIMESHEET_SUMMARY_CHANNEL_ID);
    if (summaryChannel && summaryChannel.isTextBased() && !summaryChannel.isDMBased()) {
      await summaryChannel.send({ embeds: [summaryEmbed] });
    }
  } catch (error) {
    await prisma.dailySummaryRun.delete({ where: { summaryDate } }).catch(() => null);
    throw error;
  }
}

async function weeklySummary(client: Client): Promise<void> {
  const now = DateTime.now().setZone(env.TIMEZONE);
  const weekStart = now.startOf("week");
  const weekEnd = now.endOf("week");

  const entries = await prisma.timeEntry.findMany({
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
    .setTitle("Raport Saptamanal Pontaj")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Saptamana: ${formatDate(weekStart.toJSDate(), env.TIMEZONE)} - ${formatDate(weekEnd.toJSDate(), env.TIMEZONE)}` })
    .setTimestamp();

  const summaryChannel = await client.channels.fetch(env.TIMESHEET_SUMMARY_CHANNEL_ID);
  if (summaryChannel && summaryChannel.isTextBased() && !summaryChannel.isDMBased()) {
    await summaryChannel.send({ embeds: [summaryEmbed] });
  }
}

export function startTimesheetScheduler(client: Client): void {
  cron.schedule(`${env.AUTO_CLOCK_OUT_MINUTE} ${env.AUTO_CLOCK_OUT_HOUR} * * *`, async () => {
    await runScheduledJob("shop-close-auto-clock-out", async () => {
      await autoClockOut(client);
    });
  }, { timezone: env.TIMEZONE });

  cron.schedule(`${env.DAILY_SUMMARY_MINUTE} ${env.DAILY_SUMMARY_HOUR} * * *`, async () => {
    await runScheduledJob("daily-summary", async () => {
      await dailySummary(client);
    });
  }, { timezone: env.TIMEZONE });

  cron.schedule("0 19 * * 0", async () => {
    await runScheduledJob("weekly-summary", async () => {
      await weeklySummary(client);
    });
  }, { timezone: env.TIMEZONE });
}
