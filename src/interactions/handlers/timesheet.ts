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
  postLog,
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

export async function handleTimesheetEditCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const dateStr = interaction.options.getString("date");
  const clockInStr = interaction.options.getString("clock-in");
  const clockOutStr = interaction.options.getString("clock-out");
  const shouldDelete = interaction.options.getBoolean("delete") ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const employee = await prisma.employee.findUnique({ where: { discordUserId: targetUser.id } });
  if (!employee) {
    await interaction.editReply({ content: `<@${targetUser.id}> nu este un angajat inregistrat.` });
    return;
  }

  const now = DateTime.now().setZone(env.TIMEZONE);
  let targetDay: DateTime;
  if (dateStr) {
    const parsed = DateTime.fromFormat(dateStr, "dd.MM.yyyy", { zone: env.TIMEZONE });
    if (!parsed.isValid) {
      await interaction.editReply({ content: `Format data invalid: \`${dateStr}\`. Foloseste formatul dd.MM.yyyy (ex: 30.03.2026).` });
      return;
    }
    targetDay = parsed;
  } else {
    targetDay = now.startOf("day");
  }

  const dayStart = targetDay.startOf("day").toJSDate();
  const dayEnd = targetDay.endOf("day").toJSDate();

  const entries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      clockInAt: { gte: dayStart, lte: dayEnd }
    },
    orderBy: { clockInAt: "desc" }
  });

  if (entries.length === 0) {
    await interaction.editReply({ content: `Nu exista intrari de pontaj pentru <@${targetUser.id}> in data de ${formatDate(dayStart, env.TIMEZONE)}.` });
    return;
  }

  const entry = entries[0]!;

  if (shouldDelete) {
    await prisma.timeEntryAudit.create({
      data: {
        timeEntryId: entry.id,
        editedById: interaction.user.id,
        fieldName: "DELETE",
        oldValue: `clockIn=${formatTime(entry.clockInAt, env.TIMEZONE)}, clockOut=${entry.clockOutAt ? formatTime(entry.clockOutAt, env.TIMEZONE) : "OPEN"}, duration=${entry.durationMinutes ?? 0}min`,
        newValue: "DELETED"
      }
    });

    if (entry.sourceMessageId) {
      const archiveChannel = asTextChannel(await client.channels.fetch(env.TIMESHEET_ARCHIVE_CHANNEL_ID).catch(() => null));
      if (archiveChannel) {
        const msg = await archiveChannel.messages.fetch(entry.sourceMessageId).catch(() => null);
        if (msg) {
          await msg.delete().catch(() => null);
        }
      }
    }

    await prisma.timeEntry.delete({ where: { id: entry.id } });

    await postLog(client, new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("Timesheet Entry Deleted")
      .addFields(
        { name: "Employee", value: `<@${targetUser.id}>`, inline: true },
        { name: "Deleted by", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Date", value: formatDate(entry.clockInAt, env.TIMEZONE), inline: true },
        { name: "Was", value: `${formatTime(entry.clockInAt, env.TIMEZONE)} - ${entry.clockOutAt ? formatTime(entry.clockOutAt, env.TIMEZONE) : "OPEN"}`, inline: false }
      )
      .setTimestamp()
    );

    await interaction.editReply({ content: `Intrarea de pontaj a lui <@${targetUser.id}> din ${formatDate(entry.clockInAt, env.TIMEZONE)} a fost stearsa.` });

    const timesheetChannel = asTextChannel(await interaction.guild!.channels.fetch(env.TIMESHEET_CHANNEL_ID).catch(() => null));
    if (timesheetChannel) {
      await updateTimesheetPanel(client, timesheetChannel).catch(() => null);
    }
    return;
  }

  if (!clockInStr && !clockOutStr) {
    await interaction.editReply({ content: "Trebuie sa specifici cel putin `clock-in`, `clock-out`, sau `delete`." });
    return;
  }

  const updates: { clockInAt?: Date; clockOutAt?: Date; durationMinutes?: number; status?: TimeEntryStatus } = {};
  const audits: { fieldName: string; oldValue: string; newValue: string }[] = [];

  let newClockIn = entry.clockInAt;
  let newClockOut = entry.clockOutAt;

  if (clockInStr) {
    const parsed = DateTime.fromFormat(clockInStr, "HH:mm", { zone: env.TIMEZONE });
    if (!parsed.isValid) {
      await interaction.editReply({ content: `Format clock-in invalid: \`${clockInStr}\`. Foloseste HH:mm (ex: 19:30).` });
      return;
    }
    const newTime = targetDay.set({ hour: parsed.hour, minute: parsed.minute, second: 0, millisecond: 0 });
    audits.push({ fieldName: "clockInAt", oldValue: formatTime(entry.clockInAt, env.TIMEZONE), newValue: clockInStr });
    updates.clockInAt = newTime.toJSDate();
    newClockIn = newTime.toJSDate();
  }

  if (clockOutStr) {
    const parsed = DateTime.fromFormat(clockOutStr, "HH:mm", { zone: env.TIMEZONE });
    if (!parsed.isValid) {
      await interaction.editReply({ content: `Format clock-out invalid: \`${clockOutStr}\`. Foloseste HH:mm (ex: 23:00).` });
      return;
    }
    const newTime = targetDay.set({ hour: parsed.hour, minute: parsed.minute, second: 0, millisecond: 0 });
    audits.push({ fieldName: "clockOutAt", oldValue: entry.clockOutAt ? formatTime(entry.clockOutAt, env.TIMEZONE) : "OPEN", newValue: clockOutStr });
    updates.clockOutAt = newTime.toJSDate();
    updates.status = TimeEntryStatus.CLOSED;
    newClockOut = newTime.toJSDate();
  }

  if (newClockOut) {
    const dur = Math.max(1, Math.round((newClockOut.getTime() - newClockIn.getTime()) / 60000));
    if (dur <= 0) {
      await interaction.editReply({ content: "Clock-out trebuie sa fie dupa clock-in." });
      return;
    }
    updates.durationMinutes = dur;
  }

  await prisma.timeEntry.update({ where: { id: entry.id }, data: updates });

  for (const audit of audits) {
    await prisma.timeEntryAudit.create({
      data: { timeEntryId: entry.id, editedById: interaction.user.id, ...audit }
    });
  }

  const updatedEntry = await prisma.timeEntry.findUnique({ where: { id: entry.id } });

  if (updatedEntry && updatedEntry.clockOutAt) {
    const logEmbed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle("Clock Out (Edited)")
      .addFields(
        { name: "Employee", value: `<@${targetUser.id}>`, inline: true },
        { name: "Edited by", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Interval", value: formatRange(updatedEntry.clockInAt, updatedEntry.clockOutAt, env.TIMEZONE), inline: false },
        { name: "Total", value: `${durationToHuman(updatedEntry.durationMinutes ?? 0)} (${updatedEntry.durationMinutes} min)`, inline: false }
      )
      .setTimestamp();

    await upsertTimesheetArchiveMessage(client, updatedEntry.id, updatedEntry.sourceMessageId ?? null, logEmbed);
  }

  await postLog(client, new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle("Timesheet Entry Edited")
    .addFields(
      { name: "Employee", value: `<@${targetUser.id}>`, inline: true },
      { name: "Edited by", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Changes", value: audits.map((a) => `**${a.fieldName}**: ${a.oldValue} → ${a.newValue}`).join("\n"), inline: false }
    )
    .setTimestamp()
  );

  const changesSummary = audits.map((a) => `${a.fieldName}: ${a.oldValue} → ${a.newValue}`).join(", ");
  await interaction.editReply({ content: `Pontajul lui <@${targetUser.id}> din ${formatDate(entry.clockInAt, env.TIMEZONE)} a fost actualizat. (${changesSummary})` });

  const timesheetChannel = asTextChannel(await interaction.guild!.channels.fetch(env.TIMESHEET_CHANNEL_ID).catch(() => null));
  if (timesheetChannel) {
    await updateTimesheetPanel(client, timesheetChannel).catch(() => null);
  }
}

export async function handleTimesheetViewCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  const period = interaction.options.getString("period") ?? "week";

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const employee = await prisma.employee.findUnique({ where: { discordUserId: targetUser.id } });
  if (!employee) {
    await interaction.editReply({ content: `<@${targetUser.id}> nu este un angajat inregistrat.` });
    return;
  }

  const now = DateTime.now().setZone(env.TIMEZONE);
  let rangeStart: DateTime;
  let rangeEnd: DateTime;
  let periodLabel: string;

  switch (period) {
    case "today":
      rangeStart = now.startOf("day");
      rangeEnd = now.endOf("day");
      periodLabel = `Azi (${formatDate(rangeStart.toJSDate(), env.TIMEZONE)})`;
      break;
    case "month":
      rangeStart = now.startOf("month");
      rangeEnd = now.endOf("month");
      periodLabel = `Luna curenta (${formatDate(rangeStart.toJSDate(), env.TIMEZONE)} - ${formatDate(rangeEnd.toJSDate(), env.TIMEZONE)})`;
      break;
    case "week":
    default:
      rangeStart = now.startOf("week");
      rangeEnd = now.endOf("week");
      periodLabel = `Saptamana curenta (${formatDate(rangeStart.toJSDate(), env.TIMEZONE)} - ${formatDate(rangeEnd.toJSDate(), env.TIMEZONE)})`;
      break;
  }

  const entries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      clockInAt: { gte: rangeStart.toJSDate(), lte: rangeEnd.toJSDate() }
    },
    orderBy: { clockInAt: "asc" }
  });

  if (entries.length === 0) {
    await interaction.editReply({ content: `Nu exista intrari de pontaj pentru <@${targetUser.id}> in perioada: ${periodLabel}.` });
    return;
  }

  let totalMinutes = 0;
  const lines = entries.map((entry) => {
    const date = formatDate(entry.clockInAt, env.TIMEZONE);
    const clockIn = formatTime(entry.clockInAt, env.TIMEZONE);
    const clockOut = entry.clockOutAt ? formatTime(entry.clockOutAt, env.TIMEZONE) : "...";
    const duration = entry.durationMinutes ? durationToHuman(entry.durationMinutes) : "in curs";
    totalMinutes += entry.durationMinutes ?? 0;
    const statusIcon = entry.status === "OPEN" ? "🟢" : "✅";
    return `${statusIcon} **${date}** | ${clockIn} - ${clockOut} | ${duration}`;
  });

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(`Pontaj: ${employee.displayName}`)
    .setDescription(lines.join("\n"))
    .addFields(
      { name: "Total", value: `${durationToHuman(totalMinutes)} (${totalMinutes} min)`, inline: true },
      { name: "Intrari", value: `${entries.length}`, inline: true }
    )
    .setFooter({ text: periodLabel })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
