import {
  ApplicationCommandOptionType,
  CommandInteraction,
  Role,
} from "discord.js";
import type { Interaction } from "discord.js";
import { Discord, On, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import type { StringSelectMenuInteraction } from "discord.js";
import {
  addHelpWantedRequest,
  ensureHelpWantedMessage,
  listHelpWantedRequests,
  removeHelpWantedRequest,
} from "../services/helpWantedService.js";
import {
  buildComponentsV2Flags,
  safeDeferReply,
  safeReply,
} from "../lib/discord/interactionUtils.js";
import { CHANNELS } from "../config/channels.js";
import { buildSimpleTextContainer } from "../services/eventUiService.js";

@Discord()
@SlashGroup({ description: "Help requests", name: "help" })
export class HelpWantedCommand {
  @SlashGroup("help")
  @Slash({ description: "Request help from specific roles", name: "request" })
  async request(
    @SlashOption({
      description: "Describe the help you need",
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
      description: "Requesting help on behalf of someone",
      name: "requester",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    requesterLabel: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

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
      interaction.user.id,
      normalizedDescription,
      roleIds,
      requesterLabel,
    );

    await ensureHelpWantedMessage(interaction.client as any, CHANNELS.HELP_WANTED);

    const successPayload = buildSimpleTextContainer("Your help request has been posted.");
    await safeReply(interaction, {
      components: [successPayload],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SlashGroup("help")
  @Slash({ description: "Mark a help request as done", name: "done" })
  async done(
    @SlashOption({
      description: "Help request to mark as done",
      name: "task",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      autocomplete: true,
    })
    taskId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    await removeHelpWantedRequest(taskId);
    await ensureHelpWantedMessage(interaction.client as any, CHANNELS.HELP_WANTED);

    const payload = buildSimpleTextContainer("Help request marked as done.");
    await safeReply(interaction, {
      components: [payload],
      flags: buildComponentsV2Flags(true),
    });
  }

  @On({ event: "interactionCreate" })
  async handleAutocomplete(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== "help") return;
      if (interaction.options.getSubcommand(false) !== "done") return;
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "task") return;

      const queryText = String(focused.value ?? "").toLowerCase();
      const requests = await listHelpWantedRequests();

      const matches = requests
        .filter((request) => {
          const description = request.description.toLowerCase();
          return description.includes(queryText);
        })
        .slice(0, 25)
        .map((request) => ({
          name: `#${request.id} ${request.description}`.slice(0, 100),
          value: request.id,
        }));

      await interaction.respond(matches);
    }
  }

  @SelectMenuComponent({ id: /^help-complete:[^:]+:[^:]+(?::\d+)?$/ })
  async handleHelpWantedComplete(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferUpdate();
      } catch (err) {
        console.error("Failed to defer help wanted select update:", err);
      }
    }

    const selectedId = Number(interaction.values[0]);
    if (!Number.isFinite(selectedId)) {
      return;
    }

    await removeHelpWantedRequest(selectedId);
    await ensureHelpWantedMessage(interaction.client as any, CHANNELS.HELP_WANTED);
  }
}
