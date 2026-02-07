import { PermissionsBitField } from "discord.js";
import { buildComponentsV2Flags, safeReply, type AnyRepliable } from "../../lib/discord/interactionUtils.js";
import { buildSimpleTextContainer } from "../../services/eventUiService.js";

const replyAccessDenied = async (interaction: AnyRepliable, message: string): Promise<void> => {
  await safeReply(interaction, {
    components: [buildSimpleTextContainer(message)],
    flags: buildComponentsV2Flags(true),
  });
};

export const getTodoPermissionFlags = (interaction: AnyRepliable): {
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
} | null => {
  const guild = interaction.guild;
  if (!guild) return null;

  const member: any = interaction.member;
  const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;
  const isModerator = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  return { isOwner, isAdmin, isModerator };
};

export const requireModeratorOrAdminOrOwner = async (
  interaction: AnyRepliable,
): Promise<boolean> => {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await replyAccessDenied(interaction, "This command can only be used inside a server.");
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await replyAccessDenied(
    interaction,
    "Access denied. Command requires Moderator, Administrator, or server owner.",
  );
  return false;
};

export const requireOwner = async (interaction: AnyRepliable): Promise<boolean> => {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await replyAccessDenied(interaction, "This command can only be used inside a server.");
    return false;
  }

  if (permissions.isOwner) {
    return true;
  }

  await replyAccessDenied(interaction, "Access denied. Command requires server owner.");
  return false;
};
