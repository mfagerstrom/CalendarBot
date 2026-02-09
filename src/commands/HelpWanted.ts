import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  CommandInteraction,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  Role,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} from "discord.js";
import type { Interaction, ModalSubmitInteraction, StringSelectMenuInteraction } from "discord.js";
import { Discord, ModalComponent, On, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import {
  addHelpWantedCompletion,
  addHelpWantedRequest,
  ensureHelpWantedMessage,
  getHelpWantedRequestById,
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

const HELP_COMPLETE_MODAL_PREFIX = "help-complete-modal";
const HELP_COMPLETE_MODAL_REGEX = /^help-complete-modal:\d+$/;
const HELP_COMPLETE_TEXT_INPUT_ID = "help-complete-description";

@Discord()
@SlashGroup({ description: "Help requests", name: "help" })
export class HelpWantedCommand {
  private parseHelpCompletionRequestId(customId: string): number | null {
    const parts = customId.split(":");
    if (parts.length !== 2 || parts[0] !== HELP_COMPLETE_MODAL_PREFIX) {
      return null;
    }
    const requestId = Number(parts[1]);
    return Number.isFinite(requestId) ? requestId : null;
  }

  private buildHelpCompletionModal(requestId: number): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`${HELP_COMPLETE_MODAL_PREFIX}:${requestId}`)
      .setTitle("Complete Help Request")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(HELP_COMPLETE_TEXT_INPUT_ID)
            .setLabel("What was done?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
  }

  private async sendHelpCompletionAnnouncement(
    interaction: ModalSubmitInteraction,
    requesterId: string,
    completedByUserId: string,
    originalRequestDescription: string,
    completionDescription: string,
  ): Promise<void> {
    const channel = await interaction.client.channels.fetch(CHANNELS.HELP_WANTED_TALK);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("# Help Request Completed"),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `<@${requesterId}> your help request was completed.\n` +
          `Completed by: <@${completedByUserId}>\n` +
          `Original request: ${originalRequestDescription}\n` +
          `Action taken: ${completionDescription}`,
        ),
      );

    const allowedMentionUsers = Array.from(new Set([requesterId, completedByUserId]));

    await (channel as any).send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        users: allowedMentionUsers,
      },
    });
  }

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
    const selectedId = Number(interaction.values[0]);
    if (!Number.isFinite(selectedId)) {
      return;
    }

    const request = await getHelpWantedRequestById(selectedId);
    if (!request) {
      const payload = buildSimpleTextContainer("That help request is no longer active.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const modal = this.buildHelpCompletionModal(request.id);
    await interaction.showModal(modal);
  }

  @ModalComponent({ id: HELP_COMPLETE_MODAL_REGEX })
  async handleHelpWantedCompleteModal(interaction: ModalSubmitInteraction): Promise<void> {
    const requestId = this.parseHelpCompletionRequestId(interaction.customId);
    if (!requestId) {
      const payload = buildSimpleTextContainer("This completion form is no longer valid.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const request = await getHelpWantedRequestById(requestId);
    if (!request) {
      const payload = buildSimpleTextContainer("That help request is already completed.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const completionDescription = interaction.fields
      .getTextInputValue(HELP_COMPLETE_TEXT_INPUT_ID)
      .replace(/\s+/g, " ")
      .trim();
    if (!completionDescription) {
      const payload = buildSimpleTextContainer("Completion description cannot be empty.");
      await safeReply(interaction, {
        components: [payload],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await addHelpWantedCompletion({
      requestId: request.id,
      requesterId: request.requesterId,
      requesterLabel: request.requesterLabel ?? null,
      roleIds: request.roleIds,
      requestDescription: request.description,
      completedByUserId: interaction.user.id,
      completionDescription,
    });
    await removeHelpWantedRequest(request.id);
    await ensureHelpWantedMessage(interaction.client as any, CHANNELS.HELP_WANTED);
    await this.sendHelpCompletionAnnouncement(
      interaction,
      request.requesterId,
      interaction.user.id,
      request.description,
      completionDescription,
    );

    const payload = buildSimpleTextContainer("Help request marked as complete.");
    await safeReply(interaction, {
      components: [payload],
      flags: buildComponentsV2Flags(true),
    });
  }
}
