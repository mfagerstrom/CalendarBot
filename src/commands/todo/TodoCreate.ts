import {
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  ButtonStyle,
  ActionRowBuilder as ModalActionRowBuilder,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonComponent, Discord, ModalComponent, SelectMenuComponent } from "discordx";
import { createIssue } from "../../services/githubIssuesService.js";
import {
  createTodoCreateSession,
  deleteTodoCreateSession,
  getTodoCreateSession,
  updateTodoCreateSessionLabels,
  type ITodoCreateSession,
} from "../../services/todoSessionService.js";
import { buildComponentsV2Flags, safeReply, safeUpdate } from "../../lib/discord/interactionUtils.js";
import { buildSimpleTextContainer } from "../../services/eventUiService.js";
import { requireOwner } from "./todoPermissions.js";
import { MAX_ISSUE_BODY, sanitizeTodoRichText } from "./todoTextUtils.js";
import { TODO_LABELS, type TodoLabel } from "./todoConstants.js";
import { getGithubErrorMessage } from "./todoGithubErrors.js";

const TODO_CREATE_LABEL_PREFIX = "todo-create-label";
const TODO_CREATE_SUBMIT_PREFIX = "todo-create-submit";
const TODO_CREATE_CANCEL_PREFIX = "todo-create-cancel";
const TODO_CREATE_MODAL_PREFIX = "todo-create-modal";
const TODO_CREATE_TITLE_ID = "todo-create-title";
const TODO_CREATE_BODY_ID = "todo-create-body";

const buildTodoCreateModalId = (payloadToken: string, page: number): string => {
  return `${TODO_CREATE_MODAL_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoCreateLabelId = (sessionId: string): string => {
  return `${TODO_CREATE_LABEL_PREFIX}:${sessionId}`;
};

const buildTodoCreateSubmitId = (sessionId: string): string => {
  return `${TODO_CREATE_SUBMIT_PREFIX}:${sessionId}`;
};

const buildTodoCreateCancelId = (sessionId: string): string => {
  return `${TODO_CREATE_CANCEL_PREFIX}:${sessionId}`;
};

const parseCreateModalId = (customId: string): {
  payloadToken: string;
  page: number;
} | null => {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== TODO_CREATE_MODAL_PREFIX) return null;
  const page = Number(parts[2]);
  if (!Number.isFinite(page)) return null;
  return { payloadToken: parts[1], page };
};

const parseCreateSessionId = (customId: string, prefix: string): { sessionId: string } | null => {
  const parts = customId.split(":");
  if (parts.length !== 2 || parts[0] !== prefix) return null;
  return { sessionId: parts[1] };
};

export const buildTodoCreateModal = (payloadToken: string, page: number): ModalBuilder => {
  const modal = new ModalBuilder()
    .setCustomId(buildTodoCreateModalId(payloadToken, page))
    .setTitle("Create GitHub Issue");

  const titleInput = new TextInputBuilder()
    .setCustomId(TODO_CREATE_TITLE_ID)
    .setLabel("Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256);

  const bodyInput = new TextInputBuilder()
    .setCustomId(TODO_CREATE_BODY_ID)
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_ISSUE_BODY);

  modal.addComponents(
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(bodyInput),
  );

  return modal;
};

const buildTodoCreateFormComponents = (
  session: ITodoCreateSession,
  sessionId: string,
): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Create GitHub Issue"),
  );

  const titleText = session.title ? session.title : "*No title set.*";
  const bodyText = session.body ? session.body : "*No description provided.*";
  const labelText = session.labels.length ? session.labels.join(", ") : "None";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Title:**\n${titleText}\n\n**Description:**\n${bodyText}\n\n**Labels:**\n${labelText}`,
    ),
  );

  const labelSelect = new StringSelectMenuBuilder()
    .setCustomId(buildTodoCreateLabelId(sessionId))
    .setPlaceholder("Select Labels (multi-select)")
    .setMinValues(0)
    .setMaxValues(TODO_LABELS.length)
    .addOptions(
      TODO_LABELS.map((label) => ({
        label,
        value: label,
        default: session.labels.includes(label),
      })),
    );

  const labelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(labelSelect);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoCreateSubmitId(sessionId))
      .setLabel("Create")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.title.trim().length),
    new ButtonBuilder()
      .setCustomId(buildTodoCreateCancelId(sessionId))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  container.addActionRowComponents(labelRow);
  container.addActionRowComponents(actionRow);

  return { components: [container] };
};

@Discord()
export class TodoCreateInteractions {
  @ModalComponent({ id: /^todo-create-modal:[^:]+:\d+$/ })
  async submitCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCreateModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const rawTitle = interaction.fields.getTextInputValue(TODO_CREATE_TITLE_ID);
    const rawBody = interaction.fields.getTextInputValue(TODO_CREATE_BODY_ID);
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Title cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const trimmedBody = rawBody
      ? sanitizeTodoRichText(rawBody)
      : "";
    if (!trimmedBody.trim()) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Description cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const sessionId = await createTodoCreateSession(
      interaction.user.id,
      parsed.payloadToken,
      parsed.page,
      interaction.channelId ?? "",
      interaction.message?.id ?? "",
      trimmedTitle,
      trimmedBody.slice(0, MAX_ISSUE_BODY),
    );

    const session = await getTodoCreateSession(sessionId);
    if (!session) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Unable to start issue creation.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const formPayload = buildTodoCreateFormComponents(session, sessionId);
    await safeReply(interaction, {
      ...formPayload,
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^todo-create-label:\d+$/ })
  async setCreateLabels(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseCreateSessionId(interaction.customId, TODO_CREATE_LABEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const session = await getTodoCreateSession(parsed.sessionId);
    if (!session || session.userId !== interaction.user.id) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const selectedValues = interaction.values;
    const labels = selectedValues
      .map((value) => TODO_LABELS.find((label) => label === value))
      .filter((label): label is TodoLabel => Boolean(label));

    await updateTodoCreateSessionLabels(parsed.sessionId, labels);

    const updatedSession = await getTodoCreateSession(parsed.sessionId);
    if (!updatedSession) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const formPayload = buildTodoCreateFormComponents(updatedSession, parsed.sessionId);
    await safeUpdate(interaction, {
      ...formPayload,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^todo-create-submit:\d+$/ })
  async submitCreateFromForm(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCreateSessionId(interaction.customId, TODO_CREATE_SUBMIT_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const session = await getTodoCreateSession(parsed.sessionId);
    if (!session || session.userId !== interaction.user.id) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const trimmedTitle = sanitizeTodoRichText(session.title).trim();
    if (!trimmedTitle) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("Title cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const trimmedBody = session.body
      ? sanitizeTodoRichText(session.body)
      : undefined;
    const baseBody = trimmedBody ?? "";
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const prefixedBody = isOwner ? baseBody : `${interaction.user.username}: ${baseBody}`;
    const finalBody = prefixedBody.length ? prefixedBody.slice(0, MAX_ISSUE_BODY) : null;

    try {
      await createIssue({
        title: trimmedTitle,
        body: finalBody,
        labels: session.labels,
      });
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const listModule = await import("./TodoList.js");
    const listPayload = await listModule.buildTodoListPayload(session.payloadToken, session.page);
    if (listPayload) {
      const message = await interaction.client.channels.fetch(session.channelId)
        .then((channel) => (channel && channel.isTextBased() && "messages" in channel)
          ? (channel as any).messages.fetch(session.messageId)
          : null)
        .catch(() => null);

      if (message) {
        try {
          await message.edit({ components: listPayload.components });
        } catch {
          // ignore refresh failures
        }
      }
    }

    await deleteTodoCreateSession(parsed.sessionId);
    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-create-cancel:\d+$/ })
  async cancelCreateFromForm(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCreateSessionId(interaction.customId, TODO_CREATE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This create form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await deleteTodoCreateSession(parsed.sessionId);
    try {
      await interaction.deleteReply();
    } catch {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("Create issue cancelled.")],
        flags: buildComponentsV2Flags(true),
      });
    }
  }
}
