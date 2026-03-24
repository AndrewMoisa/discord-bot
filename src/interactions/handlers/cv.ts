import {
  ActionRowBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { HireRequestStatus } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import { isManager } from "../../utils/permissions";
import {
  asTextChannel,
  buildCvEmbed,
  buildHireButtons,
  postApprovedCv,
  postLog,
  requireGuildMember,
} from "../utils";

export async function handleCvCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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
      await targetMember.roles.add(env.EMPLOYEE_ROLE_ID);
    } catch (error) {
      roleAssignError = error instanceof Error ? error.message : "Unknown error";
    }
  } else {
    roleAssignError = "Member not found in guild";
  }

  let approveMessage = `<@${request.targetUserId}>'s submission has been accepted successfully by <@${interaction.user.id}> | ${interaction.user.username}`;
  if (roleAssignError) {
    approveMessage += `\n\n🔴 Couldn't assign role <@&${env.EMPLOYEE_ROLE_ID}> due to the following reason: ${roleAssignError}`;
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

export async function handleCvModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
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
  if (!guild) {
    await interaction.reply({ content: "Guild not available for this action.", ephemeral: true });
    return;
  }

  const hiringChannel = asTextChannel(await guild.channels.fetch(env.CV_CHANNEL_ID));
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

  await prisma.hireRequest.update({
    where: { id: request.id },
    data: { messageId: message.id }
  });

  await interaction.reply({ content: `CV submission created: ${request.id}`, ephemeral: true });
}

export async function handleHireButton(client: Client, interaction: ButtonInteraction): Promise<boolean> {
  const [group, action, requestId] = interaction.customId.split(":");

  if (group === "hire" && requestId && (action === "approve" || action === "reject")) {
    await handleHireReview(client, interaction, action, requestId);
    return true;
  }

  return false;
}
