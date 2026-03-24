import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Channel,
  Client,
  Colors,
  EmbedBuilder,
  GuildBasedChannel,
  GuildMember,
  GuildTextBasedChannel,
} from "discord.js";
import { prisma } from "../db";
import { env } from "../env";

export function asTextChannel(channel: Channel | GuildBasedChannel | null): GuildTextBasedChannel | null {
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return null;
  }

  return channel as GuildTextBasedChannel;
}

export function requireGuildMember(member: GuildMember | null): GuildMember {
  if (!member) {
    throw new Error("Guild member not found in interaction context");
  }

  return member;
}

export function buildHireButtons(requestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hire:approve:${requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hire:reject:${requestId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

export function buildTimesheetButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("time:clockin").setLabel("Clock In").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("time:clockout").setLabel("Clock Out").setStyle(ButtonStyle.Danger)
  );
}

export function buildCvEmbed(request: {
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

export async function postLog(client: Client, embed: EmbedBuilder): Promise<void> {
  const logsChannel = asTextChannel(await client.channels.fetch(env.LOG_CHANNEL_ID));
  if (!logsChannel) {
    return;
  }

  await logsChannel.send({ embeds: [embed] });
}

export async function postApprovedCv(client: Client, embed: EmbedBuilder): Promise<void> {
  const approvedChannel = asTextChannel(await client.channels.fetch(env.CV_APPROVED_CHANNEL_ID));
  if (!approvedChannel) {
    return;
  }

  await approvedChannel.send({ embeds: [embed] });
}

export async function upsertTimesheetArchiveMessage(
  client: Client,
  entryId: string,
  messageId: string | null,
  embed: EmbedBuilder
): Promise<string | null> {
  const archiveChannel = asTextChannel(await client.channels.fetch(env.TIMESHEET_ARCHIVE_CHANNEL_ID));
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
  await prisma.timeEntry.update({
    where: { id: entryId },
    data: { sourceMessageId: created.id }
  });

  return created.id;
}
