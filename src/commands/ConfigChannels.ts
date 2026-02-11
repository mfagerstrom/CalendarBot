import { ApplicationCommandOptionType, CommandInteraction } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { buildSimpleTextContainer } from "../services/eventUiService.js";
import {
  buildComponentsV2Flags,
  safeDeferReply,
  safeReply,
} from "../lib/discord/interactionUtils.js";
import {
  clearGuildChannelConfig,
  getDefaultChannelId,
  isGuildChannelKey,
  listEffectiveGuildChannels,
  listGuildChannelKeys,
  setGuildChannelConfig,
} from "../services/guildChannelConfigService.js";

@Discord()
@SlashGroup({ description: "Server configuration commands", name: "config" })
@SlashGroup("config")
@SlashGroup({ description: "Manage server channel routing", name: "channel", root: "config" })
export class ConfigChannelsCommand {
  @SlashGroup("channel", "config")
  @Slash({ description: "Show effective channel configuration for this server", name: "list" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    if (!interaction.guildId) {
      const payload = buildSimpleTextContainer("This command can only be used inside a server.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const mapping = await listEffectiveGuildChannels(interaction.guildId);
    const lines = listGuildChannelKeys().map((key) => {
      const channelId = mapping[key];
      const defaultId = getDefaultChannelId(key);
      const suffix = channelId === defaultId ? " (default)" : " (override)";
      return `- \`${key}\`: <#${channelId}>${suffix}`;
    });

    const payload = buildSimpleTextContainer(
      `# Channel Config\nGuild: \`${interaction.guildId}\`\n${lines.join("\n")}`,
    );
    await safeReply(interaction, {
      components: [payload],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SlashGroup("channel", "config")
  @Slash({ description: "Set a channel mapping for this server", name: "set" })
  async set(
    @SlashOption({
      description: "Channel key to configure",
      name: "key",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    keyRaw: string,
    @SlashOption({
      description: "Channel to use for this key",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: any,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    if (!interaction.guildId) {
      const payload = buildSimpleTextContainer("This command can only be used inside a server.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const key = String(keyRaw ?? "").trim().toUpperCase();
    if (!isGuildChannelKey(key)) {
      const valid = listGuildChannelKeys().join(", ");
      const payload = buildSimpleTextContainer(
        `Unknown key \`${key}\`.\nValid keys: ${valid}`,
      );
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const channelId = String(channel?.id ?? "").trim();
    if (!channelId) {
      const payload = buildSimpleTextContainer("A valid channel is required.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await setGuildChannelConfig(interaction.guildId, key, channelId);
    const payload = buildSimpleTextContainer(
      `Updated \`${key}\` to <#${channelId}> for this server.`,
    );
    await safeReply(interaction, {
      components: [payload],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SlashGroup("channel", "config")
  @Slash({ description: "Clear a channel override and use default", name: "clear" })
  async clear(
    @SlashOption({
      description: "Channel key to reset",
      name: "key",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    keyRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    if (!interaction.guildId) {
      const payload = buildSimpleTextContainer("This command can only be used inside a server.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const key = String(keyRaw ?? "").trim().toUpperCase();
    if (!isGuildChannelKey(key)) {
      const valid = listGuildChannelKeys().join(", ");
      const payload = buildSimpleTextContainer(
        `Unknown key \`${key}\`.\nValid keys: ${valid}`,
      );
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await clearGuildChannelConfig(interaction.guildId, key);
    const defaultId = getDefaultChannelId(key);
    const payload = buildSimpleTextContainer(
      `Cleared \`${key}\` override. Now using default <#${defaultId}>.`,
    );
    await safeReply(interaction, {
      components: [payload],
      flags: buildComponentsV2Flags(true),
    });
  }
}

