import {
  ChatInputCommandInteraction,
  Client,
  Colors,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
} from "discord.js";
import { prisma } from "../../db";
import { env } from "../../env";
import { postLog } from "../utils";

export async function handleDeactivateCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") ?? "Fara motiv specificat.";

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const employee = await prisma.employee.findUnique({ where: { discordUserId: targetUser.id } });
  if (!employee) {
    await interaction.editReply({ content: `<@${targetUser.id}> nu este un angajat inregistrat.` });
    return;
  }

  if (!employee.isActive) {
    await interaction.editReply({ content: `<@${targetUser.id}> este deja dezactivat.` });
    return;
  }

  const openEntries = await prisma.timeEntry.updateMany({
    where: { employeeId: employee.id, status: "OPEN" },
    data: {
      clockOutAt: new Date(),
      durationMinutes: 0,
      status: "CLOSED"
    }
  });

  await prisma.employee.update({
    where: { id: employee.id },
    data: { isActive: false }
  });

  const guild = interaction.guild!;
  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  let roleRemoved = false;
  if (member) {
    await member.roles.remove(env.EMPLOYEE_ROLE_ID).catch(() => null);
    roleRemoved = true;
  }

  await postLog(client, new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle("Employee Deactivated")
    .addFields(
      { name: "Employee", value: `<@${targetUser.id}> (${employee.displayName})`, inline: true },
      { name: "Deactivated by", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Reason", value: reason, inline: false },
      { name: "Open entries closed", value: `${openEntries.count}`, inline: true },
      { name: "Role removed", value: roleRemoved ? "Da" : "Nu (user not in server)", inline: true }
    )
    .setTimestamp()
  );

  await interaction.editReply({
    content: `<@${targetUser.id}> a fost dezactivat.\nMotiv: ${reason}\nPontaje deschise inchise: ${openEntries.count}\nRol eliminat: ${roleRemoved ? "Da" : "Nu"}`
  });
}
