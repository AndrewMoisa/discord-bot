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
import { PrismaClient } from "@prisma/client";
import { HireRequestStatus, TimeEntryStatus } from "@prisma/client";
import { env } from "../env";
import { getGuildRuntimeConfig, parseManagerRoleInput } from "../tenancy/config";
import { provisionGuildTenant } from "../tenancy/provision";
import { getTenantPrisma } from "../tenancy/tenantDb";
import { isManager } from "../utils/permissions";
import { durationToHuman, formatDate, formatRange, formatTime } from "../utils/time";
import { TENANT_SCHEMA_VERSION } from "../tenancy/schema";

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

const lastTimesheetPanelMessageIds = new Map<string, string>();
const clockCooldowns = new Map<string, number>();
const CLOCK_COOLDOWN_MS = 60000;

function ensureOwner(userId: string): void {
  if (!env.ownerUserIds.includes(userId)) {
    throw new Error("Only bot owners can use this command.");
  }
}

function getCooldownKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function postLog(client: Client, logChannelId: string, embed: EmbedBuilder): Promise<void> {
  const logsChannel = asTextChannel(await client.channels.fetch(logChannelId));
  if (!logsChannel) {
    return;
  }

  await logsChannel.send({ embeds: [embed] });
}

async function postApprovedCv(client: Client, approvedChannelId: string, embed: EmbedBuilder): Promise<void> {
  const approvedChannel = asTextChannel(await client.channels.fetch(approvedChannelId));
  if (!approvedChannel) {
    return;
  }

  await approvedChannel.send({ embeds: [embed] });
}

async function postTimesheetArchive(client: Client, archiveChannelId: string, embed: EmbedBuilder): Promise<void> {
  const archiveChannel = asTextChannel(await client.channels.fetch(archiveChannelId));
  if (!archiveChannel) {
    return;
  }

  await archiveChannel.send({ embeds: [embed] });
}

async function upsertTimesheetArchiveMessage(
  tenantPrisma: PrismaClient,
  client: Client,
  archiveChannelId: string,
  entryId: string,
  messageId: string | null,
  embed: EmbedBuilder
): Promise<string | null> {
  const archiveChannel = asTextChannel(await client.channels.fetch(archiveChannelId));
  if (!archiveChannel) {
    return null;
  }

  if (messageId) {
    const existing = await archiveChannel.messages.fetch(messageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed] });
      return existing.id;
    }
  }

  const created = await archiveChannel.send({ embeds: [embed] });
  await tenantPrisma.timeEntry.update({
    where: { id: entryId },
    data: { sourceMessageId: created.id }
  });

  return created.id;
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

async function loadTimesheetPanelMessage(guildId: string, channel: GuildTextBasedChannel): Promise<string | null> {
  const lastMessageId = lastTimesheetPanelMessageIds.get(guildId);
  if (lastMessageId) {
    return lastMessageId;
  }

  const messages = await channel.messages.fetch({ limit: 20 });
  const panelMessage = messages.find((message) =>
    message.author.id === channel.client.user?.id &&
    message.embeds.some((embed) => embed.title === "Timesheet Panel")
  );

  if (!panelMessage) {
    return null;
  }

  lastTimesheetPanelMessageIds.set(guildId, panelMessage.id);
  return panelMessage.id;
}

async function updateTimesheetPanel(
  tenantPrisma: PrismaClient,
  guildId: string,
  timezone: string,
  channel: GuildTextBasedChannel
): Promise<void> {
  const messageId = await loadTimesheetPanelMessage(guildId, channel);
  if (!messageId) {
    return;
  }

  const openEntries = await tenantPrisma.timeEntry.findMany({
    where: { status: TimeEntryStatus.OPEN },
    include: { employee: true },
    orderBy: { clockInAt: "asc" }
  });

  const lines = openEntries.map((entry) =>
    `- <@${entry.employee.discordUserId}> | ${formatTime(entry.clockInAt, timezone)}`
  );

  const description = lines.length > 0
    ? `Pontaj activ:\n${lines.join("\n")}`
    : "Nu exista pontaj activ.";

  const panelEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("Timesheet Panel")
    .setDescription(description)
    .setFooter({ text: `Actualizat: ${formatDate(new Date(), timezone)}` })
    .setTimestamp();

  await channel.messages.edit(messageId, { embeds: [panelEmbed], components: [buildTimesheetButtons()] });
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

  if (interaction.commandName === "tenant-status") {
    try {
      ensureOwner(interaction.user.id);
      const config = await getGuildRuntimeConfig(guild.id);
      const statusEmbed = new EmbedBuilder()
        .setColor(config.isProvisioned ? Colors.Green : Colors.Orange)
        .setTitle("Tenant Status")
        .addFields(
          { name: "Guild", value: `${guild.name} (${guild.id})`, inline: false },
          { name: "Schema", value: config.schemaName, inline: true },
          { name: "Provisioned", value: config.isProvisioned ? "Yes" : "No", inline: true },
          { name: "Schema Version", value: String(TENANT_SCHEMA_VERSION), inline: true },
          { name: "Timezone", value: config.timezone, inline: true },
          { name: "Manager Roles", value: config.managerRoleIds.join(", ") || "None", inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [statusEmbed], ephemeral: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch tenant status.";
      await interaction.reply({ content: message, ephemeral: true });
    }

    return;
  }

  if (interaction.commandName === "tenant-setup") {
    try {
      ensureOwner(interaction.user.id);
      const config = {
        employeeRoleId: interaction.options.getString("employee_role_id", true).trim(),
        cvChannelId: interaction.options.getString("cv_channel_id", true).trim(),
        cvApprovedChannelId: interaction.options.getString("cv_approved_channel_id", true).trim(),
        timesheetChannelId: interaction.options.getString("timesheet_channel_id", true).trim(),
        timesheetArchiveChannelId: interaction.options.getString("timesheet_archive_channel_id", true).trim(),
        timesheetSummaryChannelId: interaction.options.getString("timesheet_summary_channel_id", true).trim(),
        logChannelId: interaction.options.getString("log_channel_id", true).trim(),
        managerRoleIds: parseManagerRoleInput(interaction.options.getString("manager_role_ids", true)),
        timezone: interaction.options.getString("timezone")?.trim() || "Europe/Bucharest",
      };

      await interaction.deferReply({ ephemeral: true });
      await provisionGuildTenant({
        guildId: guild.id,
        guildName: guild.name,
        actorUserId: interaction.user.id,
        config,
      });

      await interaction.editReply("Tenant setup completed successfully for this guild.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tenant setup failed.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }

    return;
  }

  let guildConfig;
  try {
    guildConfig = await getGuildRuntimeConfig(guild.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guild configuration is missing.";
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const member = requireGuildMember(interaction.member as GuildMember);
  const managerAllowed = isManager(member, guildConfig.managerRoleIds);

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
    const timesheetChannel = asTextChannel(await guild.channels.fetch(guildConfig.timesheetChannelId));

    if (!timesheetChannel) {
      await interaction.reply({ content: "Timesheet channel is not configured correctly.", ephemeral: true });
      return;
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("Timesheet Panel")
      .setDescription("Nu exista pontaj activ.")
      .setTimestamp();

    const message = await timesheetChannel.send({ embeds: [panelEmbed], components: [buildTimesheetButtons()] });
    lastTimesheetPanelMessageIds.set(guild.id, message.id);
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

  let guildConfig;
  try {
    guildConfig = await getGuildRuntimeConfig(guild.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guild configuration is missing.";
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const tenantPrisma = await getTenantPrisma(guild.id);

  const member = requireGuildMember(interaction.member as GuildMember);
  if (!isManager(member, guildConfig.managerRoleIds)) {
    await interaction.reply({ content: "Only managers/admins can review hiring requests.", ephemeral: true });
    return;
  }

  const request = await tenantPrisma.hireRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    await interaction.reply({ content: "Hiring request not found.", ephemeral: true });
    return;
  }

  if (request.status !== HireRequestStatus.PENDING) {
    await interaction.reply({ content: `This request is already ${request.status}.`, ephemeral: true });
    return;
  }

  if (action === "reject") {
    await tenantPrisma.hireRequest.update({
      where: { id: request.id },
      data: {
        status: HireRequestStatus.REJECTED,
        reviewedById: interaction.user.id,
        reviewedAt: new Date(),
        reviewReason: "Rejected by reviewer"
      }
    });

    const rejectMessage = `<@${request.targetUserId}>'s submission has been rejected by <@${interaction.user.id}> | ${interaction.user.username}`;
    await postLog(client, guildConfig.logChannelId, new EmbedBuilder().setColor(Colors.Red).setDescription(rejectMessage));
    await interaction.update({ content: `Request ${request.id} rejected by <@${interaction.user.id}>.`, components: [] });
    return;
  }

  const approvedAt = new Date();

  await tenantPrisma.$transaction(async (tx) => {
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
      await targetMember.roles.add(guildConfig.employeeRoleId);
    } catch (error) {
      roleAssignError = error instanceof Error ? error.message : "Unknown error";
    }
  } else {
    roleAssignError = "Member not found in guild";
  }

  let approveMessage = `<@${request.targetUserId}>'s submission has been accepted successfully by <@${interaction.user.id}> | ${interaction.user.username}`;
  if (roleAssignError) {
    approveMessage += `\n\n🔴 Couldn't assign role <@&${guildConfig.employeeRoleId}> due to the following reason: ${roleAssignError}`;
  }

  await postApprovedCv(
    client,
    guildConfig.cvApprovedChannelId,
    buildCvEmbed({
      fullName: request.fullName,
      cnp: request.cnp,
      phone: request.phone,
      idCardUrl: request.idCardUrl,
      referredBy: request.referredBy,
      targetUserId: request.targetUserId
    }).setFooter({ text: "Status: APPROVED" })
  );

  await postLog(client, guildConfig.logChannelId, new EmbedBuilder().setColor(Colors.Green).setDescription(approveMessage));
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

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this action.", ephemeral: true });
    return;
  }

  let guildConfig;
  try {
    guildConfig = await getGuildRuntimeConfig(guild.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guild configuration is missing.";
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const tenantPrisma = await getTenantPrisma(guild.id);

  const request = await tenantPrisma.hireRequest.create({
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

  const hiringChannel = asTextChannel(await guild.channels.fetch(guildConfig.cvChannelId));
  if (!hiringChannel) {
    await interaction.reply({ content: "Hiring channel is not configured correctly.", ephemeral: true });
    return;
  }

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

  await tenantPrisma.hireRequest.update({
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

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this action.", ephemeral: true });
    return;
  }

  let guildConfig;
  try {
    guildConfig = await getGuildRuntimeConfig(guild.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guild configuration is missing.";
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const tenantPrisma = await getTenantPrisma(guild.id);

  const member = requireGuildMember(interaction.member as GuildMember);
  if (!member.roles.cache.has(guildConfig.employeeRoleId)) {
    await interaction.reply({ content: "You do not have permission to use the timesheet.", ephemeral: true });
    return;
  }

  const now = Date.now();
  const cooldownKey = getCooldownKey(guild.id, interaction.user.id);
  const lastClick = clockCooldowns.get(cooldownKey) ?? 0;
  if (now - lastClick < CLOCK_COOLDOWN_MS) {
    await interaction.reply({ content: "Please wait a few seconds before clicking again.", ephemeral: true });
    return;
  }
  clockCooldowns.set(cooldownKey, now);

  const employee = await tenantPrisma.employee.findUnique({ where: { discordUserId: interaction.user.id } });

  if (!employee || !employee.isActive) {
    await interaction.reply({ content: "You are not an active employee.", ephemeral: true });
    return;
  }

  const openEntry = await tenantPrisma.timeEntry.findFirst({
    where: { employeeId: employee.id, status: TimeEntryStatus.OPEN }
  });

  if (!openEntry) {
    const created = await tenantPrisma.timeEntry.create({
      data: {
        employeeId: employee.id,
        status: TimeEntryStatus.OPEN,
        sourceMessageId: null
      }
    });

    const logEmbed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("Clock In")
      .addFields(
        { name: "Employee", value: `<@${interaction.user.id}>`, inline: true },
        { name: "At", value: formatTime(created.clockInAt, guildConfig.timezone), inline: true }
      )
      .setTimestamp();

    await upsertTimesheetArchiveMessage(tenantPrisma, client, guildConfig.timesheetArchiveChannelId, created.id, null, logEmbed);
    await interaction.reply({ content: `Clock In registered at ${formatTime(created.clockInAt, guildConfig.timezone)}.`, ephemeral: true });
    const timesheetChannel = asTextChannel(await guild.channels.fetch(guildConfig.timesheetChannelId));
    if (timesheetChannel) {
      await updateTimesheetPanel(tenantPrisma, guild.id, guildConfig.timezone, timesheetChannel);
    }
    return;
  }

  const clockOutAt = new Date();
  const durationMinutes = Math.max(1, Math.round((clockOutAt.getTime() - openEntry.clockInAt.getTime()) / 60000));

  const closedEntry = await tenantPrisma.timeEntry.update({
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
      { name: "Interval", value: formatRange(closedEntry.clockInAt, clockOutAt, guildConfig.timezone), inline: false },
      { name: "Total", value: `${durationToHuman(durationMinutes)} (${durationMinutes} min)`, inline: false }
    )
    .setTimestamp();

  await upsertTimesheetArchiveMessage(
    tenantPrisma,
    client,
    guildConfig.timesheetArchiveChannelId,
    closedEntry.id,
    closedEntry.sourceMessageId ?? null,
    logEmbed
  );
  await interaction.reply({ content: `Clock Out registered. Total: ${durationToHuman(durationMinutes)}.`, ephemeral: true });

  const timesheetChannel = asTextChannel(await guild.channels.fetch(guildConfig.timesheetChannelId));
  if (timesheetChannel) {
    await updateTimesheetPanel(tenantPrisma, guild.id, guildConfig.timezone, timesheetChannel);
  }
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
