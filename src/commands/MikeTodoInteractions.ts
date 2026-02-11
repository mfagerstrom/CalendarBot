import type { StringSelectMenuInteraction } from "discord.js";
import type { Client } from "discordx";
import { Discord, SelectMenuComponent } from "discordx";
import {
  MIKE_TODO_COMPLETE_SELECT_REGEX,
  completeMikeTodoTask,
} from "../services/mikeTodoListService.js";
import {
  buildComponentsV2Flags,
  safeDeferReply,
  safeReply,
} from "../lib/discord/interactionUtils.js";
import { buildSimpleTextContainer } from "../services/eventUiService.js";
import { getGuildChannelId } from "../services/guildChannelConfigService.js";

@Discord()
export class MikeTodoInteractions {
  @SelectMenuComponent({ id: MIKE_TODO_COMPLETE_SELECT_REGEX })
  async handleMarkComplete(interaction: StringSelectMenuInteraction): Promise<void> {
    const taskId = String(interaction.values[0] ?? "").trim();
    if (!taskId) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("No task was selected.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    try {
      if (!interaction.guildId) {
        await safeReply(interaction, {
          components: [buildSimpleTextContainer("This action must be used inside a server.")],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      const todoChannelId = await getGuildChannelId(interaction.guildId, "TODO_LIST");
      await completeMikeTodoTask(
        interaction.client as unknown as Client,
        todoChannelId,
        taskId,
      );
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Task marked complete.")],
        flags: buildComponentsV2Flags(true),
      });
    } catch (err: any) {
      const status = Number(err?.response?.status ?? 0);
      const errorText = String(err?.response?.data?.error ?? err?.message ?? "Unknown error");
      const message = status === 404
        ? "That task no longer exists."
        : `Failed to mark task complete: ${errorText}`;
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(message)],
        flags: buildComponentsV2Flags(true),
      });
    }
  }
}
