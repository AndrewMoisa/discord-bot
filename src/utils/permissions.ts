import { GuildMember, PermissionFlagsBits } from "discord.js";

export function isManager(member: GuildMember, managerRoleIds: string[]): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return managerRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
