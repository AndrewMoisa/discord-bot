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
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { HireRequestStatus, TimeEntryStatus } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { isManager } from "../utils/permissions";
import { durationToHuman, formatRange } from "../utils/time";

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
    new ButtonBuilder().setCustomId("time:toggle").setLabel("Clock").setStyle(ButtonStyle.Success)
  );
}

async function postLog(client: Client, embed: EmbedBuilder): Promise<void> {
  const logsChannel = asTextChannel(await client.channels.fetch(env.CHANNEL_LOGS_ID));
  if (!logsChannel) {
    return;
  }

  await logsChannel.send({ embeds: [embed] });
}

async function postApprovedCv(client: Client, embed: EmbedBuilder): Promise<void> {
  const approvedChannel = asTextChannel(await client.channels.fetch(env.CHANNEL_APPROVED_CV_ID));
  if (!approvedChannel) {
    return;
  }

  await approvedChannel.send({ embeds: [embed] });
}

async function postTimesheetArchive(client: Client, embed: EmbedBuilder): Promise<void> {
  const archiveChannel = asTextChannel(await client.channels.fetch(env.CHANNEL_TIMESHEET_ARCHIVE_ID));
  if (!archiveChannel) {
    return;
  }

  await archiveChannel.send({ embeds: [embed] });
}

function buildCvEmbed(request: {
  fullName: string;
  cnp: string;
  phone: string;
  idCardUrl: string;
  referredBy: string;
  targetUserId: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle("Depunere CV Application Submitted")
    .setDescription(`<@${request.targetUserId}>'s 'Depunere CV' Application Submitted`)
    .addFields(
      { name: "1. · Nume & Prenume:", value: request.fullName, inline: false },
      { name: "2. · CNP:", value: request.cnp, inline: false },
      { name: "3. · Numar de telefon:", value: request.phone, inline: false },
      { name: "4. · Poza cu buletinul [LINK]", value: `[LINK](${request.idCardUrl})`, inline: false },
      { name: "5. · De cine ai fost adus?", value: request.referredBy, inline: false }
    )
    .setFooter({ text: "Status: PENDING" })
    .setTimestamp();
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

  if (interaction.commandName === "cv") {
    const target = interaction.options.getUser("user", true);

    const modal = new ModalBuilder()
      .setCustomId(`cv:submit:${target.id}`)
      .setTitle("Depunere CV");

    const fullNameInput = new TextInputBuilder()
      .setCustomId("full_name")
      .setLabel("Nume & Prenume")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const cnpInput = new TextInputBuilder()
      .setCustomId("cnp")
      .setLabel("CNP")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const phoneInput = new TextInputBuilder()
      .setCustomId("phone")
      .setLabel("Numar de telefon")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const idCardInput = new TextInputBuilder()
      .setCustomId("id_card_url")
      .setLabel("Poza cu buletinul (URL)")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const referredByInput = new TextInputBuilder()
      .setCustomId("referred_by")
      .setLabel("De cine ai fost adus?")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(fullNameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cnpInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(phoneInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(idCardInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(referredByInput)
    );

    await interaction.showModal(modal);
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
      .setDescription("Apasa Clock pentru a porni sau opri pontajul.")
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

    const rejectMessage = `<@${request.targetUserId}>'s submission has been rejected by <@${interaction.user.id}> | ${interaction.user.username}`;
    await postLog(client, new EmbedBuilder().setColor(Colors.Red).setDescription(rejectMessage));
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
        position: "Armurier",
        department: null,
        notes: null,
        hiredById: request.requesterId,
        hiredAt: approvedAt,
        roleAssignedAt: approvedAt,
        isActive: true
      },
      update: {
        displayName: request.fullName,
        position: "Armurier",
        department: null,
        notes: null,
        isActive: true,
        roleAssignedAt: approvedAt
      }
    });
  });

  const targetMember = await guild.members.fetch(request.targetUserId).catch(() => null);
  let roleAssignError: string | null = null;
  if (targetMember) {
    try {
      await targetMember.roles.add(env.ROLE_EMPLOYEE_ID);
    } catch (error) {
      roleAssignError = error instanceof Error ? error.message : "Unknown error";
    }
  } else {
    roleAssignError = "Member not found in guild";
  }

  let approveMessage = `<@${request.targetUserId}>'s submission has been accepted successfully by <@${interaction.user.id}> | ${interaction.user.username}`;
  if (roleAssignError) {
    approveMessage += `\n\n🔴 Couldn't assign role <@&${env.ROLE_EMPLOYEE_ID}> due to the following reason: ${roleAssignError}`;
  }

  await postApprovedCv(
    client,
    buildCvEmbed({
      fullName: request.fullName,
      cnp: request.cnp,
      phone: request.phone,
      idCardUrl: request.idCardUrl,
      referredBy: request.referredBy,
      targetUserId: request.targetUserId
    }).setFooter({ text: "Status: APPROVED" })
  );

  await postLog(client, new EmbedBuilder().setColor(Colors.Green).setDescription(approveMessage));
  await interaction.update({ content: `Request ${request.id} approved by <@${interaction.user.id}>.`, components: [] });
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This action can only be used in a server.", ephemeral: true });
    return;
  }

  const [prefix, action, targetUserId] = interaction.customId.split(":");
  if (prefix !== "cv" || action !== "submit" || !targetUserId) {
    await interaction.reply({ content: "Invalid modal submission.", ephemeral: true });
    return;
  }

  const fullName = interaction.fields.getTextInputValue("full_name").trim();
  const cnp = interaction.fields.getTextInputValue("cnp").trim();
  const phone = interaction.fields.getTextInputValue("phone").trim();
  const idCardUrl = interaction.fields.getTextInputValue("id_card_url").trim();
  const referredBy = interaction.fields.getTextInputValue("referred_by").trim();

  const request = await prisma.hireRequest.create({
    data: {
      requesterId: interaction.user.id,
      targetUserId,
      fullName,
      cnp,
      phone,
      idCardUrl,
      referredBy
    }
  });

  const guild = interaction.guild;
  const hiringChannel = asTextChannel(await guild.channels.fetch(env.CHANNEL_HIRING_ID));
  if (!hiringChannel) {
    await interaction.reply({ content: "Hiring channel is not configured correctly.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue);

  const cvEmbed = buildCvEmbed({
    fullName,
    cnp,
    phone,
    idCardUrl,
    referredBy,
    targetUserId
  });

  const message = await hiringChannel.send({
    embeds: [cvEmbed],
    components: [buildHireButtons(request.id)]
  });

  await prisma.hireRequest.update({
    where: { id: request.id },
    data: { messageId: message.id }
  });

  await interaction.reply({ content: `CV submission created: ${request.id}`, ephemeral: true });
}

async function handleClockToggle(client: Client, interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This action can only be used in a server.", ephemeral: true });
    return;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  if (!member.roles.cache.has(env.ROLE_EMPLOYEE_ID)) {
    await interaction.reply({ content: "You do not have permission to use the timesheet.", ephemeral: true });
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

  if (!openEntry) {
    const created = await prisma.timeEntry.create({
      data: {
        employeeId: employee.id,
        status: TimeEntryStatus.OPEN,
        sourceMessageId: interaction.message.id
      }
    });

    await interaction.reply({ content: `Clock In registered at ${created.clockInAt.toLocaleString()}.`, ephemeral: true });
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

  await postTimesheetArchive(client, logEmbed);
  await interaction.reply({ content: `Clock Out registered. Total: ${durationToHuman(durationMinutes)}.`, ephemeral: true });
}

export async function handleButton(client: Client, interaction: ButtonInteraction): Promise<void> {
  const [group, action, requestId] = interaction.customId.split(":");

  if (group === "hire" && requestId && (action === "approve" || action === "reject")) {
    await handleHireReview(client, interaction, action, requestId);
    return;
  }

  if (group === "time" && action === "toggle") {
    await handleClockToggle(client, interaction);
  }
}
