import {
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  ButtonStyle,
  StringSelectMenuInteraction,
  ActionRowBuilder as ModalActionRowBuilder,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
} from "discordx";
import {
  addComment,
  closeIssue,
  getIssue,
  listIssueComments,
  reopenIssue,
  setIssueLabels,
  updateIssue,
  type IGithubIssue,
  type IGithubIssueComment,
} from "../../services/githubIssuesService.js";
import {
  buildComponentsV2Flags,
  safeDeferReply,
  safeReply,
  safeUpdate,
  type AnyRepliable,
} from "../../lib/discord/interactionUtils.js";
import { buildSimpleTextContainer } from "../../services/eventUiService.js";
import { requireModeratorOrAdminOrOwner, requireOwner } from "./todoPermissions.js";
import { parseTodoPayloadToken, type TodoListPayload } from "./todoPayload.js";
import { TODO_LABELS, type TodoLabel } from "./todoConstants.js";
import { getGithubErrorMessage } from "./todoGithubErrors.js";
import {
  addIssueImagesToContainer,
  addTextDisplayWithBudget,
  buildIssueCommentsDisplay,
  formatDiscordTimestamp,
  formatIssueTitle,
  MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE,
  MAX_ISSUE_BODY,
  renderTodoContent,
  sanitizeTodoRichText,
} from "./todoTextUtils.js";

const TODO_LIST_BACK_ID_PREFIX = "todo-list-back";
const TODO_COMMENT_BUTTON_PREFIX = "todo-comment-button";
const TODO_COMMENT_MODAL_PREFIX = "todo-comment-modal";
const TODO_COMMENT_INPUT_ID = "todo-comment-input";
const TODO_EDIT_TITLE_BUTTON_PREFIX = "todo-edit-title-button";
const TODO_EDIT_TITLE_MODAL_PREFIX = "todo-edit-title-modal";
const TODO_EDIT_TITLE_INPUT_ID = "todo-edit-title-input";
const TODO_EDIT_DESC_BUTTON_PREFIX = "todo-edit-desc-button";
const TODO_EDIT_DESC_MODAL_PREFIX = "todo-edit-desc-modal";
const TODO_EDIT_DESC_INPUT_ID = "todo-edit-desc-input";
const TODO_CLOSE_VIEW_PREFIX = "todo-close-view";
const TODO_REOPEN_VIEW_PREFIX = "todo-reopen-view";
const TODO_LABEL_EDIT_BUTTON_PREFIX = "todo-label-edit-button";
const TODO_LABEL_EDIT_SELECT_PREFIX = "todo-label-edit-select";
const buildTodoListBackId = (payloadToken: string, page: number): string => {
  return `${TODO_LIST_BACK_ID_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoCommentButtonId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_COMMENT_BUTTON_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoCommentModalId = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_COMMENT_MODAL_PREFIX}:${payloadToken}:${page}:${issueNumber}:${channelId}:${messageId}`;
};

const buildTodoEditTitleButtonId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_EDIT_TITLE_BUTTON_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoEditTitleModalId = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_EDIT_TITLE_MODAL_PREFIX}:${payloadToken}:${page}:${issueNumber}:${channelId}:${messageId}`;
};

const buildTodoEditDescButtonId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_EDIT_DESC_BUTTON_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoEditDescModalId = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_EDIT_DESC_MODAL_PREFIX}:${payloadToken}:${page}:${issueNumber}:${channelId}:${messageId}`;
};

const buildTodoCloseViewId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_CLOSE_VIEW_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoReopenViewId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_REOPEN_VIEW_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoLabelEditButtonId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_LABEL_EDIT_BUTTON_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoLabelEditSelectId = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_LABEL_EDIT_SELECT_PREFIX}:${payloadToken}:${page}:${issueNumber}:${channelId}:${messageId}`;
};
const parseListCustomId = (customId: string, prefix: string): {
  payloadToken: string;
  page: number;
} | null => {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const page = Number(parts[2]);
  if (!Number.isFinite(page)) return null;
  return { payloadToken: parts[1], page };
};

const parseIssueActionId = (customId: string, prefix: string): {
  payloadToken: string;
  page: number;
  issueNumber: number;
} | null => {
  const parts = customId.split(":");
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!Number.isFinite(page) || !Number.isFinite(issueNumber)) return null;
  return { payloadToken: parts[1], page, issueNumber };
};

const parseIssueModalId = (customId: string, prefix: string): {
  payloadToken: string;
  page: number;
  issueNumber: number;
  channelId: string;
  messageId: string;
} | null => {
  const parts = customId.split(":");
  if (parts.length !== 6 || parts[0] !== prefix) return null;
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!Number.isFinite(page) || !Number.isFinite(issueNumber)) return null;
  return {
    payloadToken: parts[1],
    page,
    issueNumber,
    channelId: parts[4],
    messageId: parts[5],
  };
};
const fetchMessageById = async (
  interaction: AnyRepliable,
  channelId: string,
  messageId: string,
): Promise<any | null> => {
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      return null;
    }
    return await (channel as any).messages.fetch(messageId);
  } catch {
    return null;
  }
};

export const buildIssueViewComponents = (
  issue: IGithubIssue,
  comments: IGithubIssueComment[],
  payload: TodoListPayload,
  payloadToken: string,
): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  const textBudget = { remaining: MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE };
  const titleText = issue.htmlUrl
    ? `## [${formatIssueTitle(issue)}](${issue.htmlUrl})`
    : `## ${formatIssueTitle(issue)}`;
  addTextDisplayWithBudget(container, textBudget, titleText);

  const issueBody = issue.body ?? "";
  const renderedBody = renderTodoContent(issueBody, MAX_ISSUE_BODY);
  if (renderedBody.text) {
    addTextDisplayWithBudget(container, textBudget, renderedBody.text);
  } else {
    addTextDisplayWithBudget(container, textBudget, "*No description provided.*");
  }

  const commentsDisplay = buildIssueCommentsDisplay(comments);
  if (commentsDisplay.text) {
    addTextDisplayWithBudget(container, textBudget, commentsDisplay.text);
  }
  addIssueImagesToContainer(
    container,
    [...renderedBody.imageUrls, ...commentsDisplay.imageUrls],
    textBudget,
  );

  const assignee = issue.assignee ?? "Unassigned";
  const footerLine = [
    `-# **State:** ${issue.state}`,
    `**Author:** ${issue.author ?? "Unknown"}`,
    `**Assignee:** ${assignee}`,
    `**Created:** ${formatDiscordTimestamp(issue.createdAt)}`,
    `**Updated:** ${formatDiscordTimestamp(issue.updatedAt)}`,
  ].join(" | ");
  addTextDisplayWithBudget(container, textBudget, footerLine);

  const isOpen = issue.state === "open";
  const stateButton = isOpen
    ? new ButtonBuilder()
      .setCustomId(buildTodoCloseViewId(payloadToken, payload.page, issue.number))
      .setLabel("Close Issue")
      .setStyle(ButtonStyle.Danger)
    : new ButtonBuilder()
      .setCustomId(buildTodoReopenViewId(payloadToken, payload.page, issue.number))
      .setLabel("Reopen Issue")
      .setStyle(ButtonStyle.Success);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoCommentButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Add Comment")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditTitleButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Edit Title")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditDescButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Edit Description")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoLabelEditButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Add or Edit Labels")
      .setStyle(ButtonStyle.Secondary),
    stateButton,
  );

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoListBackId(payloadToken, payload.page))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  container.addActionRowComponents(actionRow, backRow);

  return { components: [container] };
};
@Discord()
export class TodoViewInteractions {
  @ButtonComponent({ id: /^todo-list-back:[^:]+:\d+$/ })
  async listBack(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_LIST_BACK_ID_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const listModule = await import("./TodoList.js");
    await listModule.renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-close-view:[^:]+:\d+:\d+$/ })
  async closeFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_CLOSE_VIEW_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
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

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!closed) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const listModule = await import("./TodoList.js");
    const listPayload = await listModule.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await interaction.message.edit({ components: listPayload.components });
    } catch {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^todo-reopen-view:[^:]+:\d+:\d+$/ })
  async reopenFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_REOPEN_VIEW_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
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

    let reopened: IGithubIssue | null;
    try {
      reopened = await reopenIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!reopened) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const listModule = await import("./TodoList.js");
    const listPayload = await listModule.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await interaction.message.edit({ components: listPayload.components });
    } catch {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^todo-label-edit-button:[^:]+:\d+:\d+$/ })
  async editLabelsFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_LABEL_EDIT_BUTTON_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!issue) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(
        buildTodoLabelEditSelectId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setPlaceholder("Select Label(s)...")
      .setMinValues(0)
      .setMaxValues(TODO_LABELS.length)
      .addOptions(
        TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: issue.labels.includes(label),
        })),
      );

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select labels to apply to this issue."),
      )
      .addActionRowComponents(selectRow);

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^todo-label-edit-select:[^:]+:\d+:\d+:[^:]+:[^:]+$/ })
  async setLabelsFromSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseIssueModalId(interaction.customId, TODO_LABEL_EDIT_SELECT_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const labels = interaction.values.filter((label) =>
      TODO_LABELS.includes(label as TodoLabel),
    ) as TodoLabel[];

    let updated: IGithubIssue | null;
    try {
      updated = await setIssueLabels(parsed.issueNumber, labels);
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!updated) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    let comments: IGithubIssueComment[] = [];
    try {
      comments = await listIssueComments(parsed.issueNumber);
    } catch {
      comments = [];
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(updated, comments, payload, parsed.payloadToken);

    const message = await fetchMessageById(interaction, parsed.channelId, parsed.messageId);
    if (message) {
      try {
        await message.edit({ components: viewPayload.components });
      } catch {
        // ignore refresh failures
      }
    }

    await safeUpdate(interaction, {
      components: [buildSimpleTextContainer("Labels updated.")],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^todo-comment-button:[^:]+:\d+:\d+$/ })
  async addCommentFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_COMMENT_BUTTON_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const modal = buildTodoCommentModal(
      parsed.payloadToken,
      parsed.page,
      parsed.issueNumber,
      interaction.channelId,
      interaction.message?.id ?? "",
    );

    await interaction.showModal(modal);
  }

  @ModalComponent({ id: /^todo-comment-modal:[^:]+:\d+:\d+:[^:]+:[^:]+$/ })
  async submitCommentModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseIssueModalId(interaction.customId, TODO_COMMENT_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This comment form expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const rawComment = interaction.fields.getTextInputValue(TODO_COMMENT_INPUT_ID);
    const finalCommentBody = sanitizeTodoRichText(rawComment);
    if (!finalCommentBody.trim()) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Comment cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const prefixedComment = `${interaction.user.username}: ${finalCommentBody}`.slice(
      0,
      MAX_ISSUE_BODY,
    );

    try {
      await addComment(parsed.issueNumber, prefixedComment);
    } catch (err: any) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(issue, comments, payload, parsed.payloadToken);

    const message = await fetchMessageById(interaction, parsed.channelId, parsed.messageId);
    if (message) {
      try {
        await message.edit({ components: viewPayload.components });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-edit-title-button:[^:]+:\d+:\d+$/ })
  async editTitleFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_EDIT_TITLE_BUTTON_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const modal = buildTodoEditTitleModal(
      parsed.payloadToken,
      parsed.page,
      parsed.issueNumber,
      interaction.channelId,
      interaction.message?.id ?? "",
      issue.title,
    );

    await interaction.showModal(modal);
  }

  @ModalComponent({ id: /^todo-edit-title-modal:[^:]+:\d+:\d+:[^:]+:[^:]+$/ })
  async submitEditTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseIssueModalId(interaction.customId, TODO_EDIT_TITLE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This edit prompt expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const rawTitle = interaction.fields.getTextInputValue(TODO_EDIT_TITLE_INPUT_ID);
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Title cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, { title: trimmedTitle });
    } catch (err: any) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(issue, comments, payload, parsed.payloadToken);

    const message = await fetchMessageById(interaction, parsed.channelId, parsed.messageId);
    if (message) {
      try {
        await message.edit({ components: viewPayload.components });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-edit-desc-button:[^:]+:\d+:\d+$/ })
  async editDescriptionFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_EDIT_DESC_BUTTON_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This todo view expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const modal = buildTodoEditDescriptionModal(
      parsed.payloadToken,
      parsed.page,
      parsed.issueNumber,
      interaction.channelId,
      interaction.message?.id ?? "",
      issue.body,
    );

    await interaction.showModal(modal);
  }

  @ModalComponent({ id: /^todo-edit-desc-modal:[^:]+:\d+:\d+:[^:]+:[^:]+$/ })
  async submitEditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseIssueModalId(interaction.customId, TODO_EDIT_DESC_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This edit prompt expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const rawBody = interaction.fields.getTextInputValue(TODO_EDIT_DESC_INPUT_ID);
    const trimmedBody = sanitizeTodoRichText(rawBody);
    if (!trimmedBody.trim()) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("Description cannot be empty.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, {
        body: trimmedBody.slice(0, MAX_ISSUE_BODY),
      });
    } catch (err: any) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(issue, comments, payload, parsed.payloadToken);

    const message = await fetchMessageById(interaction, parsed.channelId, parsed.messageId);
    if (message) {
      try {
        await message.edit({ components: viewPayload.components });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }
}

const buildTodoCommentModal = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): ModalBuilder => {
  const modal = new ModalBuilder()
    .setCustomId(buildTodoCommentModalId(payloadToken, page, issueNumber, channelId, messageId))
    .setTitle("Add Comment");

  const commentInput = new TextInputBuilder()
    .setCustomId(TODO_COMMENT_INPUT_ID)
    .setLabel("Comment")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_ISSUE_BODY);

  modal.addComponents(
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(commentInput),
  );

  return modal;
};

const buildTodoEditTitleModal = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
  title: string,
): ModalBuilder => {
  const modal = new ModalBuilder()
    .setCustomId(buildTodoEditTitleModalId(payloadToken, page, issueNumber, channelId, messageId))
    .setTitle("Edit Title");

  const titleInput = new TextInputBuilder()
    .setCustomId(TODO_EDIT_TITLE_INPUT_ID)
    .setLabel("Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256)
    .setValue(title);

  modal.addComponents(
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
  );

  return modal;
};

const buildTodoEditDescriptionModal = (
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
  body: string | null,
): ModalBuilder => {
  const modal = new ModalBuilder()
    .setCustomId(buildTodoEditDescModalId(payloadToken, page, issueNumber, channelId, messageId))
    .setTitle("Edit Description");

  const descriptionInput = new TextInputBuilder()
    .setCustomId(TODO_EDIT_DESC_INPUT_ID)
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_ISSUE_BODY);

  if (body) {
    descriptionInput.setValue(body.slice(0, MAX_ISSUE_BODY));
  }

  modal.addComponents(
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
  );

  return modal;
};
