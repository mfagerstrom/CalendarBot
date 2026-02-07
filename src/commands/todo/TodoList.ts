import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
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
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashOption,
} from "discordx";
import {
  closeIssue,
  getIssue,
  getRepoDisplayName,
  listAllIssues,
  listIssueComments,
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
import {
  LIST_DIRECTIONS,
  LIST_SORTS,
  LIST_STATES,
  TODO_LABELS,
  type ListDirection,
  type ListSort,
  type ListState,
  type TodoLabel,
} from "./todoConstants.js";
import {
  buildTodoPayloadToken,
  clampNumber,
  isBlockedIssue,
  matchesIssueLabels,
  matchesIssueQuery,
  normalizeQuery,
  normalizeStateFilters,
  parseTodoLabels,
  parseTodoPayloadToken,
  toIssueState,
  type TodoListPayload,
} from "./todoPayload.js";
import { formatIssueLink, formatIssueSelectLabel } from "./todoTextUtils.js";
import { buildIssueViewComponents } from "./TodoView.js";
import { buildTodoCreateModal } from "./TodoCreate.js";
import { requireModeratorOrAdminOrOwner, requireOwner } from "./todoPermissions.js";
import { getGithubErrorMessage } from "./todoGithubErrors.js";

const ISSUE_LIST_TITLE = "GitHub Issues";
const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 9;
const TODO_PAYLOAD_TOKEN_MAX_LENGTH = 30;

const TODO_LIST_ID_PREFIX = "todo-list-page";
const TODO_VIEW_ID_PREFIX = "todo-view";
const TODO_CREATE_BUTTON_PREFIX = "todo-create-button";
const TODO_CLOSE_BUTTON_PREFIX = "todo-close-button";
const TODO_CLOSE_SELECT_PREFIX = "todo-close-select";
const TODO_CLOSE_CANCEL_PREFIX = "todo-close-cancel";
const TODO_QUERY_BUTTON_PREFIX = "todo-query-button";
const TODO_QUERY_MODAL_PREFIX = "todo-query-modal";
const TODO_QUERY_INPUT_ID = "todo-query-input";
const TODO_FILTER_LABEL_PREFIX = "todo-filter-label";

const buildTodoListCustomId = (payloadToken: string, page: number): string => {
  return `${TODO_LIST_ID_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoViewId = (payloadToken: string, page: number, issueNumber: number): string => {
  return `${TODO_VIEW_ID_PREFIX}:${payloadToken}:${page}:${issueNumber}`;
};

const buildTodoCreateButtonId = (payloadToken: string, page: number): string => {
  return `${TODO_CREATE_BUTTON_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoCloseButtonId = (payloadToken: string, page: number): string => {
  return `${TODO_CLOSE_BUTTON_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoCloseSelectId = (
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_CLOSE_SELECT_PREFIX}:${payloadToken}:${page}:${channelId}:${messageId}`;
};

const buildTodoCloseCancelId = (payloadToken: string, page: number): string => {
  return `${TODO_CLOSE_CANCEL_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoQueryButtonId = (payloadToken: string, page: number): string => {
  return `${TODO_QUERY_BUTTON_PREFIX}:${payloadToken}:${page}`;
};

const buildTodoQueryModalId = (
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string => {
  return `${TODO_QUERY_MODAL_PREFIX}:${payloadToken}:${page}:${channelId}:${messageId}`;
};

const buildTodoFilterLabelId = (payloadToken: string, page: number): string => {
  return `${TODO_FILTER_LABEL_PREFIX}:${payloadToken}:${page}`;
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

const parseChannelMessageId = (customId: string, prefix: string): {
  payloadToken: string;
  page: number;
  channelId: string;
  messageId: string;
} | null => {
  const parts = customId.split(":");
  if (parts.length !== 5 || parts[0] !== prefix) return null;
  const page = Number(parts[2]);
  if (!Number.isFinite(page)) return null;
  return {
    payloadToken: parts[1],
    page,
    channelId: parts[3],
    messageId: parts[4],
  };
};

const replyTodoExpired = async (
  interaction: AnyRepliable,
  message?: string,
): Promise<void> => {
  await safeReply(interaction, {
    components: [buildSimpleTextContainer(message ?? "This todo view expired.")],
    flags: buildComponentsV2Flags(true),
  });
};

const buildIssueListComponents = (
  issues: IGithubIssue[],
  totalIssues: number,
  payload: TodoListPayload,
  payloadToken: string,
): { components: ContainerBuilder[] } => {
  const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
  const labelSummary = payload.excludeBlocked
    ? "Label: Not Blocked"
    : payload.labels.length
      ? `Label: ${payload.labels.join(", ")}`
      : "Label: Any";
  const summaryParts = [
    `-# State: ${payload.state}`,
    labelSummary,
    payload.query ? `Query: ${payload.query}` : "Query: Any",
    `Sort: ${payload.sort} ${payload.direction}`,
    `Page: ${payload.page} of ${totalPages}`,
  ];

  const repoName = getRepoDisplayName();
  const title = repoName && repoName !== "/"
    ? `${ISSUE_LIST_TITLE} for ${repoName}`
    : ISSUE_LIST_TITLE;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));

  if (issues.length) {
    issues.forEach((issue) => {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatIssueLink(issue)),
      );
      section.setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(buildTodoViewId(payloadToken, payload.page, issue.number))
          .setLabel("View")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No issues found for this filter."),
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${summaryParts.join(" | ")} | Total: ${totalIssues}`),
  );

  const labelSelect = new StringSelectMenuBuilder()
    .setCustomId(buildTodoFilterLabelId(payloadToken, payload.page))
    .setPlaceholder("Filter by Label...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      [
        {
          label: "All Issues",
          value: "all",
          default: payload.labels.length === 0 && !payload.excludeBlocked,
        },
        {
          label: "Not Blocked",
          value: "not-blocked",
          default: payload.excludeBlocked,
        },
        ...TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: payload.labels.includes(label),
        })),
      ],
    );
  const labelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(labelSelect);

  const queryButton = new ButtonBuilder()
    .setCustomId(buildTodoQueryButtonId(payloadToken, payload.page))
    .setLabel(payload.query ? "Edit Query" : "Filter by Query")
    .setStyle(ButtonStyle.Secondary);

  const createButton = new ButtonBuilder()
    .setCustomId(buildTodoCreateButtonId(payloadToken, payload.page))
    .setLabel("Create Issue")
    .setStyle(ButtonStyle.Success);

  const closeButton = new ButtonBuilder()
    .setCustomId(buildTodoCloseButtonId(payloadToken, payload.page))
    .setLabel("Close Issue")
    .setStyle(ButtonStyle.Danger);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createButton,
    closeButton,
    queryButton,
  );

  if (totalPages > 1) {
    const prevDisabled = payload.page <= 1;
    const nextDisabled = payload.page >= totalPages;
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(payloadToken, payload.page - 1))
        .setLabel("Prev Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(payloadToken, payload.page + 1))
        .setLabel("Next Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled),
    );
  }

  container.addActionRowComponents(labelRow);
  container.addActionRowComponents(actionRow);

  return { components: [container] };
};

export const buildTodoListPayload = async (
  payloadToken: string,
  page: number,
): Promise<{
  components: ContainerBuilder[];
  payload: TodoListPayload;
  pageIssues: IGithubIssue[];
} | null> => {
  const basePayload = parseTodoPayloadToken(payloadToken);
  if (!basePayload) return null;

  const payload: TodoListPayload = {
    ...basePayload,
    page,
  };
  const safePerPage = clampNumber(payload.perPage, 1, MAX_PAGE_SIZE);
  if (safePerPage !== payload.perPage) {
    payload.perPage = safePerPage;
  }

  let issues: IGithubIssue[];
  try {
    issues = await listAllIssues({
      state: payload.state,
      sort: payload.sort,
      direction: payload.direction,
    });
  } catch {
    return null;
  }

  if (payload.excludeBlocked) {
    issues = issues.filter((issue) => !isBlockedIssue(issue));
  }
  if (payload.labels.length) {
    issues = issues.filter((issue) => matchesIssueLabels(issue, payload.labels));
  }
  if (payload.query) {
    issues = issues.filter((issue) => matchesIssueQuery(issue, payload.query as string));
  }

  const totalIssues = issues.length;
  const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
  const safePage = clampNumber(payload.page, 1, totalPages);
  const startIndex = (safePage - 1) * payload.perPage;
  const pageIssues = issues.slice(startIndex, startIndex + payload.perPage);

  const updatedPayload: TodoListPayload = { ...payload, page: safePage };
  const nextToken = buildTodoPayloadToken({
    perPage: updatedPayload.perPage,
    state: updatedPayload.state,
    stateFilters: updatedPayload.stateFilters,
    labels: updatedPayload.labels,
    excludeBlocked: updatedPayload.excludeBlocked,
    query: updatedPayload.query,
    sort: updatedPayload.sort,
    direction: updatedPayload.direction,
    isPublic: updatedPayload.isPublic,
  }, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
  const listPayload = buildIssueListComponents(
    pageIssues,
    totalIssues,
    updatedPayload,
    nextToken,
  );

  return {
    components: listPayload.components,
    payload: updatedPayload,
    pageIssues,
  };
};

export const renderTodoListPage = async (
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  payloadToken: string,
  page: number,
): Promise<void> => {
  const listPayload = await buildTodoListPayload(payloadToken, page);
  if (!listPayload) {
    await replyTodoExpired(interaction);
    return;
  }

  await safeUpdate(interaction, {
    components: listPayload.components,
    flags: buildComponentsV2Flags(!listPayload.payload.isPublic),
  });
};

@Discord()
export class TodoCommand {
  @Slash({ description: "List GitHub issues", name: "todo" })
  async list(
    @SlashOption({
      description: "Search text in any issue field",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashChoice(...LIST_STATES)
    @SlashOption({
      description: "Issue state",
      name: "state",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    state: ListState | undefined,
    @SlashOption({
      description: "Filter by labels (comma-separated)",
      name: "labels",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    labelsRaw: string | undefined,
    @SlashChoice(...LIST_SORTS)
    @SlashOption({
      description: "Sort order",
      name: "sort",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sort: ListSort | undefined,
    @SlashChoice(...LIST_DIRECTIONS)
    @SlashOption({
      description: "Sort direction",
      name: "direction",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    direction: ListDirection | undefined,
    @SlashOption({
      description: "Page number",
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    @SlashOption({
      description: "Results per page",
      name: "per_page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    perPage: number | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("This command can only be used in a server.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const isPublic = showInChat !== false;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(!isPublic) });

    const resolvedPerPage = clampNumber(perPage ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const parsedLabels = parseTodoLabels(labelsRaw);
    const query = normalizeQuery(queryRaw);
    if (parsedLabels.invalid.length) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(
          `Unknown labels: ${parsedLabels.invalid.join(", ")}. Valid labels: ${TODO_LABELS.join(", ")}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const initialStateFilters = normalizeStateFilters(
      state === "all" ? ["open", "closed"] : [state ?? "open"],
    );
    const effectiveState = toIssueState(initialStateFilters);

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: effectiveState,
        sort: sort ?? "updated",
        direction: direction ?? "desc",
      });
    } catch (err: any) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsedLabels.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, parsedLabels.labels));
    }
    if (query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, query));
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / resolvedPerPage));
    const resolvedPage = clampNumber(page ?? 1, 1, totalPages);
    const startIndex = (resolvedPage - 1) * resolvedPerPage;
    const pageIssues = issues.slice(startIndex, startIndex + resolvedPerPage);

    const payload: TodoListPayload = {
      page: resolvedPage,
      perPage: resolvedPerPage,
      state: effectiveState,
      stateFilters: initialStateFilters,
      labels: parsedLabels.labels,
      excludeBlocked: parsedLabels.labels.length === 0,
      query,
      sort: sort ?? "updated",
      direction: direction ?? "desc",
      isPublic,
    };
    const payloadToken = buildTodoPayloadToken({
      perPage: payload.perPage,
      state: payload.state,
      stateFilters: payload.stateFilters,
      labels: payload.labels,
      excludeBlocked: payload.excludeBlocked,
      query: payload.query,
      sort: payload.sort,
      direction: payload.direction,
      isPublic: payload.isPublic,
    }, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      payload,
      payloadToken,
    );

    await safeReply(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!isPublic),
      allowedMentions: { parse: [] },
    });
  }
}

@Discord()
export class TodoListInteractions {
  @ButtonComponent({ id: /^todo-list-page:[^:]+:\d+$/ })
  async listPage(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_LIST_ID_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }
    await renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-view:[^:]+:\d+:\d+$/ })
  async viewFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseIssueActionId(interaction.customId, TODO_VIEW_ID_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!issue) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(`Issue #${parsed.issueNumber} was not found.`)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(issue, comments, payload, parsed.payloadToken);

    await safeUpdate(interaction, {
      components: viewPayload.components,
      flags: buildComponentsV2Flags(!payload.isPublic),
    });
  }

  @SelectMenuComponent({ id: /^todo-filter-label:[^:]+:\d+$/ })
  async filterLabel(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_FILTER_LABEL_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const selected = interaction.values[0];
    const nextLabels = TODO_LABELS.includes(selected as TodoLabel) ? [selected as TodoLabel] : [];
    const excludeBlocked = selected === "not-blocked";

    basePayload.labels = nextLabels;
    basePayload.excludeBlocked = excludeBlocked;

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    await renderTodoListPage(interaction, nextToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-create-button:[^:]+:\d+$/ })
  async createFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_CREATE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const modal = buildTodoCreateModal(parsed.payloadToken, parsed.page);
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-close-button:[^:]+:\d+$/ })
  async closeFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_CLOSE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const listPayload = await buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }
    if (listPayload.pageIssues.length === 0) {
      await safeReply(interaction, {
        components: [buildSimpleTextContainer("No issues to close on this page.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const channelId = interaction.channelId;
    const messageId = interaction.message?.id ?? "";
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildTodoCloseSelectId(parsed.payloadToken, parsed.page, channelId, messageId))
      .setPlaceholder("Select an issue to close")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        listPayload.pageIssues.map((issue) => ({
          label: formatIssueSelectLabel(issue),
          value: String(issue.number),
        })),
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoCloseCancelId(parsed.payloadToken, parsed.page))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Choose an issue to close."),
      );
    container.addActionRowComponents(selectRow);
    container.addActionRowComponents(cancelRow);

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^todo-close-cancel:[^:]+:\d+$/ })
  async closeCancel(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_CLOSE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("This close menu expired.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeUpdate(interaction, {
      components: [buildSimpleTextContainer("Close issue cancelled.")],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^todo-close-select:[^:]+:\d+:[^:]+:[^:]+$/ })
  async closeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseChannelMessageId(interaction.customId, TODO_CLOSE_SELECT_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const issueNumber = Number(interaction.values[0]);
    if (!Number.isFinite(issueNumber)) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer("Invalid issue selection.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await closeIssue(issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        components: [buildSimpleTextContainer(getGithubErrorMessage(err))],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const listPayload = await buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const message = await interaction.client.channels.fetch(parsed.channelId)
      .then((channel) => (channel && channel.isTextBased() && "messages" in channel)
        ? (channel as any).messages.fetch(parsed.messageId)
        : null)
      .catch(() => null);

    if (message) {
      try {
        await message.edit({ components: listPayload.components });
      } catch {
        // ignore refresh failures
      }
    }

    await safeUpdate(interaction, {
      components: [buildSimpleTextContainer(`Closed issue #${issueNumber}.`)],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^todo-query-button:[^:]+:\d+$/ })
  async queryFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseListCustomId(interaction.customId, TODO_QUERY_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const modal = buildTodoQueryModal(
      parsed.payloadToken,
      parsed.page,
      interaction.channelId,
      interaction.message?.id ?? "",
      basePayload.query,
    );
    await interaction.showModal(modal);
  }

  @ModalComponent({ id: /^todo-query-modal:[^:]+:\d+:[^:]+:[^:]+$/ })
  async submitQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseChannelMessageId(interaction.customId, TODO_QUERY_MODAL_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction, "This query prompt expired.");
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const rawQuery = interaction.fields.getTextInputValue(TODO_QUERY_INPUT_ID);
    const query = normalizeQuery(rawQuery);

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    basePayload.query = query;

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = await buildTodoListPayload(nextToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const message = await interaction.client.channels.fetch(parsed.channelId)
      .then((channel) => (channel && channel.isTextBased() && "messages" in channel)
        ? (channel as any).messages.fetch(parsed.messageId)
        : null)
      .catch(() => null);

    if (message) {
      try {
        await message.edit({ components: listPayload.components });
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

const buildTodoQueryModal = (
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
  query: string | undefined,
): ModalBuilder => {
  const modal = new ModalBuilder()
    .setCustomId(buildTodoQueryModalId(payloadToken, page, channelId, messageId))
    .setTitle(query ? "Edit Query" : "Filter by Query");

  const queryInput = new TextInputBuilder()
    .setCustomId(TODO_QUERY_INPUT_ID)
    .setLabel("Query")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  if (query) {
    queryInput.setValue(query);
  }

  modal.addComponents(
    new ModalActionRowBuilder<TextInputBuilder>().addComponents(queryInput),
  );

  return modal;
};
