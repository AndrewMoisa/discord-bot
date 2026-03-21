import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Channel,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  GuildBasedChannel,
  GuildTextBasedChannel,
  GuildMember,
} from "discord.js";
import { HireRequestStatus, TimeEntryStatus } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { isManager } from "../utils/permissions";
import { durationToHuman, formatDiscordDate, formatRange } from "../utils/time";

function asTextChannel(channel: Channel | GuildBasedChannel | null): GuildTextBasedChannel | null {
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return null;
  }

  return channel as GuildTextBasedChannel;
}

function buildHireButtons(requestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hire:approve:${requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hire:reject:${requestId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

function buildTimesheetButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("time:in").setLabel("Clock In").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("time:out").setLabel("Clock Out").setStyle(ButtonStyle.Secondary)
  );
}

async function postLog(client: Client, embed: EmbedBuilder): Promise<void> {
  const logsChannel = asTextChannel(await client.channels.fetch(env.CHANNEL_LOGS_ID));
  if (!logsChannel) {
    return;
  }

  await logsChannel.send({ embeds: [embed] });
}

function requireGuildMember(member: GuildMember | null): GuildMember {
  if (!member) {
    throw new Error("Guild member not found in interaction context");
  }

  return member;
}

export async function handleChatCommand(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this command.", ephemeral: true });
    return;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  const managerAllowed = isManager(member, env.managerRoleIds);

  if (!managerAllowed) {
    await interaction.reply({ content: "You are not allowed to use this command.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "hire") {
    const target = interaction.options.getUser("user", true);
    const fullName = interaction.options.getString("full_name", true);
    const position = interaction.options.getString("position", true);
    const department = interaction.options.getString("department", false);
    const notes = interaction.options.getString("notes", false);

    const request = await prisma.hireRequest.create({
      data: {
        requesterId: interaction.user.id,
        targetUserId: target.id,
        fullName,
        position,
        department,
        notes
      }
    });

    const hiringChannel = asTextChannel(await guild.channels.fetch(env.CHANNEL_HIRING_ID));
    if (!hiringChannel) {
      await interaction.reply({ content: "Hiring channel is not configured correctly.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle("New Hiring Request")
      .addFields(
        { name: "Request ID", value: request.id, inline: false },
        { name: "Target User", value: `<@${target.id}>`, inline: true },
        { name: "Full Name", value: fullName, inline: true },
        { name: "Position", value: position, inline: true },
        { name: "Department", value: department ?? "N/A", inline: true },
        { name: "Requested By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Notes", value: notes ?? "N/A", inline: false }
      )
      .setFooter({ text: "Status: PENDING" })
      .setTimestamp();

    const message = await hiringChannel.send({
      embeds: [embed],
      components: [buildHireButtons(request.id)]
    });

    await prisma.hireRequest.update({
      where: { id: request.id },
      data: { messageId: message.id }
    });

    await interaction.reply({ content: `Hiring request created: ${request.id}`, ephemeral: true });
    return;
  }

  if (interaction.commandName === "setup-timesheet") {
    const timesheetChannel = asTextChannel(await guild.channels.fetch(env.CHANNEL_TIMESHEET_ID));

    if (!timesheetChannel) {
      await interaction.reply({ content: "Timesheet channel is not configured correctly.", ephemeral: true });
      return;
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("Timesheet Panel")
      .setDescription("Use Clock In at start of work and Clock Out when your shift ends.")
      .setTimestamp();

    await timesheetChannel.send({ embeds: [panelEmbed], components: [buildTimesheetButtons()] });
    await interaction.reply({ content: "Timesheet panel posted.", ephemeral: true });
  }
}

async function handleHireReview(client: Client, interaction: ButtonInteraction, action: "approve" | "reject", requestId: string): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This action can only be used in a server.", ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this action.", ephemeral: true });
    return;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  if (!isManager(member, env.managerRoleIds)) {
    await interaction.reply({ content: "Only managers/admins can review hiring requests.", ephemeral: true });
    return;
  }

  const request = await prisma.hireRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    await interaction.reply({ content: "Hiring request not found.", ephemeral: true });
    return;
  }

  if (request.status !== HireRequestStatus.PENDING) {
    await interaction.reply({ content: `This request is already ${request.status}.`, ephemeral: true });
    return;
  }

  if (action === "reject") {
    await prisma.hireRequest.update({
      where: { id: request.id },
      data: {
        status: HireRequestStatus.REJECTED,
        reviewedById: interaction.user.id,
        reviewedAt: new Date(),
        reviewReason: "Rejected by reviewer"
      }
    });

    const rejectEmbed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("Hiring Request Rejected")
      .addFields(
        { name: "Request ID", value: request.id, inline: false },
        { name: "Target User", value: `<@${request.targetUserId}>`, inline: true },
        { name: "Reviewed By", value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

    await postLog(client, rejectEmbed);
    await interaction.update({ content: `Request ${request.id} rejected by <@${interaction.user.id}>.`, components: [] });
    return;
  }

  const approvedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const updatedCount = await tx.hireRequest.updateMany({
      where: {
        id: request.id,
        status: HireRequestStatus.PENDING
      },
      data: {
        status: HireRequestStatus.APPROVED,
        reviewedById: interaction.user.id,
        reviewedAt: approvedAt
      }
    });

    if (updatedCount.count === 0) {
      throw new Error("Request already reviewed");
    }

    await tx.employee.upsert({
      where: { discordUserId: request.targetUserId },
      create: {
        discordUserId: request.targetUserId,
        displayName: request.fullName,
        position: request.position,
        department: request.department,
        notes: request.notes,
        hiredById: request.requesterId,
        hiredAt: approvedAt,
        roleAssignedAt: approvedAt,
        isActive: true
      },
      update: {
        displayName: request.fullName,
        position: request.position,
        department: request.department,
        notes: request.notes,
        isActive: true,
        roleAssignedAt: approvedAt
      }
    });
  });

  const targetMember = await guild.members.fetch(request.targetUserId).catch(() => null);
  if (targetMember) {
    await targetMember.roles.add(env.ROLE_EMPLOYEE_ID).catch(() => null);
  }

  const approveEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("Hiring Request Approved")
    .addFields(
      { name: "Request ID", value: request.id, inline: false },
      { name: "Employee", value: `<@${request.targetUserId}>`, inline: true },
      { name: "Reviewed By", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Approved At", value: formatDiscordDate(approvedAt), inline: false }
    )
    .setTimestamp();

  await postLog(client, approveEmbed);
  await interaction.update({ content: `Request ${request.id} approved by <@${interaction.user.id}>.`, components: [] });
}

async function handleClockIn(client: Client, interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This action can only be used in a server.", ephemeral: true });
    return;
  }

  const employee = await prisma.employee.findUnique({ where: { discordUserId: interaction.user.id } });

  if (!employee || !employee.isActive) {
    await interaction.reply({ content: "You are not an active employee.", ephemeral: true });
    return;
  }

  const openEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: employee.id, status: TimeEntryStatus.OPEN }
  });

  if (openEntry) {
    await interaction.reply({ content: "You already have an active clock-in. Use Clock Out first.", ephemeral: true });
    return;
  }

  const created = await prisma.timeEntry.create({
    data: {
      employeeId: employee.id,
      status: TimeEntryStatus.OPEN,
      sourceMessageId: interaction.message.id
    }
  });

  const logEmbed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("Clock In")
    .addFields(
      { name: "Employee", value: `<@${interaction.user.id}>`, inline: true },
      { name: "At", value: formatDiscordDate(created.clockInAt), inline: true }
    )
    .setTimestamp();

  await postLog(client, logEmbed);
  await interaction.reply({ content: "Clock In registered.", ephemeral: true });
}

async function handleClockOut(client: Client, interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This action can only be used in a server.", ephemeral: true });
    return;
  }

  const employee = await prisma.employee.findUnique({ where: { discordUserId: interaction.user.id } });
  if (!employee || !employee.isActive) {
    await interaction.reply({ content: "You are not an active employee.", ephemeral: true });
    return;
  }

  const openEntry = await prisma.timeEntry.findFirst({
    where: { employeeId: employee.id, status: TimeEntryStatus.OPEN },
    orderBy: { clockInAt: "desc" }
  });

  if (!openEntry) {
    await interaction.reply({ content: "You do not have an active clock-in.", ephemeral: true });
    return;
  }

  const clockOutAt = new Date();
  const durationMinutes = Math.max(1, Math.round((clockOutAt.getTime() - openEntry.clockInAt.getTime()) / 60000));

  const closedEntry = await prisma.timeEntry.update({
    where: { id: openEntry.id },
    data: {
      clockOutAt,
      durationMinutes,
      status: TimeEntryStatus.CLOSED
    }
  });

  const logEmbed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle("Clock Out")
    .addFields(
      { name: "Employee", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Interval", value: formatRange(closedEntry.clockInAt, clockOutAt, env.TIMEZONE), inline: false },
      { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
    )
    .setTimestamp();

  await postLog(client, logEmbed);
  await interaction.reply({ content: `Clock Out registered. Total: ${durationToHuman(durationMinutes)}.`, ephemeral: true });
}

export async function handleButton(client: Client, interaction: ButtonInteraction): Promise<void> {
  const [group, action, requestId] = interaction.customId.split(":");

  if (group === "hire" && requestId && (action === "approve" || action === "reject")) {
    await handleHireReview(client, interaction, action, requestId);
    return;
  }

  if (group === "time" && action === "in") {
    await handleClockIn(client, interaction);
    return;
  }

  if (group === "time" && action === "out") {
    await handleClockOut(client, interaction);
  }
}
