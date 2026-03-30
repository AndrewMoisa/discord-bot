import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  MessageFlags,
} from "discord.js";
import { Prisma, TimeEntryStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../db";
import { env } from "../../env";
import { durationToHuman, formatDate, formatDiscordDate, formatRange, formatTime } from "../../utils/time";
import {
  asTextChannel,
  buildTimesheetButtons,
  requireGuildMember,
  upsertTimesheetArchiveMessage,
} from "../utils";

let lastTimesheetPanelMessageId: string | null = null;
const clockCooldowns = new Map<string, number>();
const CLOCK_COOLDOWN_MS = 60000;
const TIMESHEET_PANEL_MESSAGE_KEY = "timesheet.panel.messageId";

async function saveTimesheetPanelMessageId(messageId: string): Promise<void> {
  await prisma.botState.upsert({
    where: { key: TIMESHEET_PANEL_MESSAGE_KEY },
    update: { value: messageId },
    create: { key: TIMESHEET_PANEL_MESSAGE_KEY, value: messageId }
  });
}

async function loadPersistedTimesheetPanelMessageId(): Promise<string | null> {
  const stored = await prisma.botState.findUnique({ where: { key: TIMESHEET_PANEL_MESSAGE_KEY } });
  return stored?.value ?? null;
}

async function clearPersistedTimesheetPanelMessageId(): Promise<void> {
  await prisma.botState.delete({ where: { key: TIMESHEET_PANEL_MESSAGE_KEY } }).catch(() => null);
}

async function loadTimesheetPanelMessage(channel: GuildTextBasedChannel): Promise<string | null> {
  if (lastTimesheetPanelMessageId) {
    return lastTimesheetPanelMessageId;
  }

  const storedMessageId = await loadPersistedTimesheetPanelMessageId();
  if (storedMessageId) {
    const storedMessage = await channel.messages.fetch(storedMessageId).catch(() => null);
    if (storedMessage) {
      lastTimesheetPanelMessageId = storedMessage.id;
      return storedMessage.id;
    }

    await clearPersistedTimesheetPanelMessageId();
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const panelMessage = messages.find((message) =>
    message.author.id === channel.client.user?.id &&
    message.embeds.some((embed) => embed.title === "Timesheet Panel")
  );

  if (!panelMessage) {
    return null;
  }

  lastTimesheetPanelMessageId = panelMessage.id;
  await saveTimesheetPanelMessageId(panelMessage.id);
  return panelMessage.id;
}

export async function updateTimesheetPanel(client: Client, channel: GuildTextBasedChannel): Promise<boolean> {
  const messageId = await loadTimesheetPanelMessage(channel);
  if (!messageId) {
    return false;
  }

  const openEntries = await prisma.timeEntry.findMany({
    where: { status: TimeEntryStatus.OPEN },
    include: { employee: true },
    orderBy: { clockInAt: "asc" }
  });

  const lines = openEntries.map((entry) =>
    `- <@${entry.employee.discordUserId}> | ${formatTime(entry.clockInAt, env.TIMEZONE)}`
  );

  const description = lines.length > 0
    ? `Pontaj activ (${lines.length}):\n${lines.join("\n")}`
    : "Nu exista pontaj activ in acest moment.";

  const panelEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("Timesheet Panel")
    .setDescription(description)
    .setFooter({ text: `Actualizat: ${formatDate(new Date(), env.TIMEZONE)}` })
    .setTimestamp();

  await channel.messages.edit(messageId, { embeds: [panelEmbed], components: [buildTimesheetButtons()] });
  return true;
}

async function validateTimesheetAccess(interaction: ButtonInteraction): Promise<{ guild: NonNullable<ButtonInteraction["guild"]>; employeeId: string } | null> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Aceasta actiune functioneaza doar pe server.", ephemeral: true });
    return null;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Serverul nu este disponibil momentan. Incearca din nou in cateva secunde.", ephemeral: true });
    return null;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  if (!member.roles.cache.has(env.EMPLOYEE_ROLE_ID)) {
    await interaction.reply({
      content: "Nu ai acces la pontaj. Daca trebuie sa ai acces, contacteaza un manager.",
      ephemeral: true
    });
    return null;
  }

  const employee = await prisma.employee.findUnique({ where: { discordUserId: interaction.user.id } });

  if (!employee || !employee.isActive) {
    await interaction.reply({
      content: "Nu esti marcat ca angajat activ. Contacteaza un manager pentru verificare.",
      ephemeral: true
    });
    return null;
  }

  return { guild, employeeId: employee.id };
}

async function consumeClockCooldown(interaction: ButtonInteraction): Promise<boolean> {
  const now = Date.now();
  const lastClick = clockCooldowns.get(interaction.user.id) ?? 0;
  if (now - lastClick < CLOCK_COOLDOWN_MS) {
    const remainingSeconds = Math.max(1, Math.ceil((CLOCK_COOLDOWN_MS - (now - lastClick)) / 1000));
    await interaction.reply({
      content: `Mai asteapta ${remainingSeconds}s inainte de urmatorul click.`,
      ephemeral: true
    });
    return false;
  }

  clockCooldowns.set(interaction.user.id, now);
  return true;
}

function canClockInAt(now: DateTime): boolean {
  const windowStart = now.set({
    hour: env.CLOCK_IN_START_HOUR,
    minute: env.CLOCK_IN_START_MINUTE,
    second: 0,
    millisecond: 0
  });
  const windowEnd = now.set({
    hour: env.CLOCK_IN_END_HOUR,
    minute: env.CLOCK_IN_END_MINUTE,
    second: 0,
    millisecond: 0
  });

  // End is exclusive: 19:00 <= clock-in < 23:00.
  return now >= windowStart && now < windowEnd;
}

async function handleClockIn(client: Client, interaction: ButtonInteraction): Promise<void> {
  const access = await validateTimesheetAccess(interaction);
  if (!access) {
    return;
  }

  if (!await consumeClockCooldown(interaction)) {
    return;
  }

  const existingOpenEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: access.employeeId, status: TimeEntryStatus.OPEN }
  });

  if (existingOpenEntry) {
    await interaction.reply({
      content: `Ai deja pontaj activ din ${formatDiscordDate(existingOpenEntry.clockInAt)}. Foloseste butonul Clock Out cand termini.`,
      ephemeral: true
    });
    return;
  }

  const now = DateTime.now().setZone(env.TIMEZONE);
  if (!canClockInAt(now)) {
    const windowStart = now.set({
      hour: env.CLOCK_IN_START_HOUR,
      minute: env.CLOCK_IN_START_MINUTE,
      second: 0,
      millisecond: 0
    });
    const windowEnd = now.set({
      hour: env.CLOCK_IN_END_HOUR,
      minute: env.CLOCK_IN_END_MINUTE,
      second: 0,
      millisecond: 0
    });

    await interaction.reply({
      content: `Clock In este disponibil doar intre ${formatDiscordDate(windowStart.toJSDate())} si ${formatDiscordDate(windowEnd.toJSDate())}. Daca este o exceptie, contacteaza un manager.`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Employee" WHERE id = ${access.employeeId} FOR UPDATE`;

    const existingLockedOpenEntry = await tx.timeEntry.findFirst({
      where: { employeeId: access.employeeId, status: TimeEntryStatus.OPEN }
    });

    if (existingLockedOpenEntry) {
      return null;
    }

    return tx.timeEntry.create({
      data: {
        employeeId: access.employeeId,
        status: TimeEntryStatus.OPEN,
        sourceMessageId: null
      }
    });
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }

    throw error;
  });

  if (!created) {
    await interaction.editReply({ content: "Ai deja un pontaj activ. Foloseste Clock Out mai intai." });
    return;
  }

  const logEmbed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("Clock In")
    .addFields(
      { name: "Employee", value: `<@${interaction.user.id}>`, inline: true },
      { name: "At", value: formatTime(created.clockInAt, env.TIMEZONE), inline: true }
    )
    .setTimestamp();

  await upsertTimesheetArchiveMessage(client, created.id, null, logEmbed);
  await interaction.editReply({
    content: `Clock In confirmat la ${formatDiscordDate(created.clockInAt)}.\nStatus: pontaj activ.`
  });

  const timesheetChannel = asTextChannel(await access.guild.channels.fetch(env.TIMESHEET_CHANNEL_ID));
  if (timesheetChannel) {
    await updateTimesheetPanel(client, timesheetChannel);
  }
}

async function handleClockOut(client: Client, interaction: ButtonInteraction): Promise<void> {
  const access = await validateTimesheetAccess(interaction);
  if (!access) {
    return;
  }

  if (!await consumeClockCooldown(interaction)) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const openEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: access.employeeId, status: TimeEntryStatus.OPEN }
  });

  if (!openEntry) {
    await interaction.editReply({
      content: "Nu ai un pontaj activ de inchis. Foloseste Clock In pentru a incepe pontajul."
    });
    return;
  }

  const clockOutAt = new Date();
  const durationMinutes = Math.max(1, Math.round((clockOutAt.getTime() - openEntry.clockInAt.getTime()) / 60000));

  const closed = await prisma.timeEntry.updateMany({
    where: { id: openEntry.id, status: TimeEntryStatus.OPEN },
    data: {
      clockOutAt,
      durationMinutes,
      status: TimeEntryStatus.CLOSED
    }
  });

  if (closed.count === 0) {
    await interaction.editReply({ content: "Intrarea de pontaj a fost deja inchisa. Da refresh si incearca din nou." });
    return;
  }

  const closedEntry = await prisma.timeEntry.findUnique({ where: { id: openEntry.id } });
  if (!closedEntry) {
    await interaction.editReply({ content: "Nu am putut incarca intrarea inchisa. Incearca din nou." });
    return;
  }

  const logEmbed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle("Clock Out")
    .addFields(
      { name: "Employee", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Interval", value: formatRange(closedEntry.clockInAt, clockOutAt, env.TIMEZONE), inline: false },
      { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
    )
    .setTimestamp();

  await upsertTimesheetArchiveMessage(client, closedEntry.id, closedEntry.sourceMessageId ?? null, logEmbed);
  await interaction.editReply({
    content: `Clock Out confirmat.\nInterval: ${formatRange(closedEntry.clockInAt, clockOutAt, env.TIMEZONE)}\nTotal: ${durationToHuman(durationMinutes)} (${durationMinutes} min).\nStatus: pontaj inchis.`
  });

  const timesheetChannel = asTextChannel(await access.guild.channels.fetch(env.TIMESHEET_CHANNEL_ID));
  if (timesheetChannel) {
    await updateTimesheetPanel(client, timesheetChannel);
  }
}

export async function handleSetupTimesheetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this command.", ephemeral: true });
    return;
  }

  const timesheetChannel = asTextChannel(await guild.channels.fetch(env.TIMESHEET_CHANNEL_ID));

  if (!timesheetChannel) {
    await interaction.reply({ content: "Timesheet channel is not configured correctly.", ephemeral: true });
    return;
  }

  const panelEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("Timesheet Panel")
    .setDescription("Foloseste butoanele pentru Clock In / Clock Out.\nNu exista pontaj activ in acest moment.")
    .setTimestamp();

  const message = await timesheetChannel.send({ embeds: [panelEmbed], components: [buildTimesheetButtons()] });
  lastTimesheetPanelMessageId = message.id;
  await saveTimesheetPanelMessageId(message.id);
  await interaction.reply({ content: "Panoul de pontaj a fost publicat cu succes.", ephemeral: true });
}

export async function handleRefreshTimesheetPanelCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this command.", ephemeral: true });
    return;
  }

  const timesheetChannel = asTextChannel(await guild.channels.fetch(env.TIMESHEET_CHANNEL_ID).catch(() => null));
  if (!timesheetChannel) {
    await interaction.reply({ content: "Timesheet channel is not configured correctly.", ephemeral: true });
    return;
  }

  const refreshed = await updateTimesheetPanel(client, timesheetChannel);
  if (!refreshed) {
    await interaction.reply({
      content: "Nu am gasit mesajul de panel. Ruleaza /setup-timesheet pentru a recrea panoul.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({ content: "Panoul de pontaj a fost actualizat manual.", ephemeral: true });
}

export async function handleTimesheetButton(client: Client, interaction: ButtonInteraction): Promise<boolean> {
  const [group, action] = interaction.customId.split(":");

  if (group === "time" && action === "clockin") {
    await handleClockIn(client, interaction);
    return true;
  }

  if (group === "time" && action === "clockout") {
    await handleClockOut(client, interaction);
    return true;
  }

  return false;
}
