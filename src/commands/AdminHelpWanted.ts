import { ApplicationCommandOptionType, CommandInteraction, Role, User } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { addHelpWantedRequest, ensureHelpWantedMessage } from "../services/helpWantedService.js";
import { buildComponentsV2Flags, safeDeferReply, safeReply } from "../lib/discord/interactionUtils.js";
import { getGuildChannelId } from "../services/guildChannelConfigService.js";
import { buildSimpleTextContainer } from "../services/eventUiService.js";

@Discord()
@SlashGroup({ description: "Admin commands", name: "admin" })
@SlashGroup("admin")
@SlashGroup({ description: "Seed help wanted requests", name: "help-wanted", root: "admin" })
export class AdminHelpWantedCommand {
  @SlashGroup("help-wanted", "admin")
  @Slash({ description: "Seed a help wanted request for another user" })
  async seed(
    @SlashOption({
      description: "User who needs help",
      name: "requester",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    requester: User,
    @SlashOption({
      description: "Describe the help needed",
      name: "description",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    description: string,
    @SlashOption({
      description: "First role to request help from",
      name: "role_1",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role1: Role,
    @SlashOption({
      description: "Second role to request help from",
      name: "role_2",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    role2: Role | undefined,
    @SlashOption({
      description: "Requester label override",
      name: "requester_label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    requesterLabel: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    if (!interaction.guildId) {
      const payload = buildSimpleTextContainer("This command can only be used in a server.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const normalizedDescription = description.replace(/\s+/g, " ").trim();
    if (!normalizedDescription) {
      const payload = buildSimpleTextContainer("Description cannot be empty.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const roleIds = [role1?.id, role2?.id].filter((value): value is string => Boolean(value));
    await addHelpWantedRequest(
      requester.id,
      normalizedDescription,
      roleIds,
      requesterLabel,
    );
    const helpWantedChannelId = await getGuildChannelId(interaction.guildId, "HELP_WANTED");
    await ensureHelpWantedMessage(interaction.client as any, helpWantedChannelId);

    const successPayload = buildSimpleTextContainer("Help request seeded.");
    await safeReply(interaction, {
      components: [successPayload],
      flags: buildComponentsV2Flags(true),
    });
  }
}
