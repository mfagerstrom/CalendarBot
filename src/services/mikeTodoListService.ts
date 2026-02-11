import axios from "axios";
import {
  ActionRowBuilder,
  ContainerBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { MessageFlags } from "discord.js";
import type { Client } from "discordx";
import { TODOIST_CONFIG } from "../config/todoist.js";
import { query } from "../lib/db/oracle.js";

const REMINDER_TIMEZONE = "America/New_York";
const TODO_SYNC_INTERVAL_MS = 60 * 1000;
const TODOIST_API_BASE_URL = "https://api.todoist.com";
const MIKE_TODO_COMPLETE_SELECT_PREFIX = "mike-todo-complete";
const MIKE_TODO_COMPLETE_SELECT_OPTION_LIMIT = 20;

interface ITodoistProject {
  id: string;
  name: string;
}

interface ITodoistSection {
  id: string;
  name: string;
  order?: number;
}

interface ITodoistTask {
  id?: string | number;
  content?: string;
  created_at?: string;
  creator_id?: string | number;
  parent_id?: string | number | null;
  order?: number;
  due?: {
    date?: string;
    datetime?: string;
    is_recurring?: boolean;
  };
  section_id?: string;
}

interface ITodoistCollaborator {
  id?: string | number;
  name?: string;
}

interface ITodoistPaginatedResponse<T> {
  next_cursor?: string | null;
  items?: T[];
  results?: T[];
}

interface ISectionSnapshot {
  completedItems: string[];
  name: string;
  neededItems: string[];
  order: number;
  sectionId: string;
  taskOptions: ISectionTaskOption[];
}

interface IMikeTodoListData {
  listId: string;
  listTitle: string;
  sections: ISectionSnapshot[];
  sourceUpdatedAt?: string;
  sourceUpdatedBy?: string;
}

interface IPreparedTodoTask {
  completableId: string;
  dueLabel: string;
  depth: number;
  id: string;
  text: string;
  order: number;
  parentId: string;
}

interface ISectionTaskOption {
  label: string;
  value: string;
}

type ChannelResolver = string | (() => Promise<string[]>);

let todoTimer: NodeJS.Timeout | null = null;
const todoSyncInProgress = new Set<string>();
const lastPayloadFingerprintByChannel = new Map<string, string>();

const todoistClient = axios.create({
  baseURL: TODOIST_API_BASE_URL,
  timeout: 15_000,
});

const normalizeItemText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const formatTimestampEt = (date: Date): string => {
  const text = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: REMINDER_TIMEZONE,
  }).format(date);
  return `${text} ET`;
};

const formatMonthDayFromYmd = (ymd: string): string => {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return ymd;
  }
  return `${match[2]}/${match[3]}`;
};

const formatMonthDayTimeInEt = (date: Date): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZone: REMINDER_TIMEZONE,
  }).formatToParts(date);

  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value.toLowerCase() ?? "";
  return `${month}/${day} ${hour}:${minute}${dayPeriod}`.trim();
};

const formatTaskDueLabel = (task: ITodoistTask): string => {
  const dueDateTime = String(task.due?.datetime ?? "");
  const dueDate = String(task.due?.date ?? "");

  if (dueDateTime) {
    const parsed = new Date(dueDateTime);
    if (!Number.isNaN(parsed.getTime())) {
      return formatMonthDayTimeInEt(parsed);
    }
  }

  if (!dueDate) {
    return "";
  }

  return formatMonthDayFromYmd(dueDate);
};

const formatYmdInTimezone = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
};

const getDueYmd = (task: ITodoistTask): string => {
  const dueDate = String(task.due?.date ?? "");
  if (dueDate) {
    return dueDate;
  }

  const dueDateTime = String(task.due?.datetime ?? "");
  if (!dueDateTime) {
    return "";
  }

  const parsed = new Date(dueDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatYmdInTimezone(parsed, REMINDER_TIMEZONE);
};

const shouldRenderTask = (task: ITodoistTask): boolean => {
  const todayYmd = formatYmdInTimezone(new Date(), REMINDER_TIMEZONE);
  const dueYmd = getDueYmd(task);
  if (!dueYmd) {
    return true;
  }

  if (task.due?.is_recurring) {
    return dueYmd === todayYmd;
  }

  return dueYmd >= todayYmd;
};

const getTodoistAuthHeaders = (): Record<string, string> => {
  if (!TODOIST_CONFIG.apiToken) {
    throw new Error("TODOIST_API_TOKEN is not configured.");
  }
  return { Authorization: `Bearer ${TODOIST_CONFIG.apiToken}` };
};

const summarizeTodoistError = (err: any): string => {
  const status = Number(err?.response?.status ?? 0);
  const message = String(err?.response?.data?.error ?? err?.message ?? "Unknown Todoist error");

  if (status === 401) {
    return "Todoist token is invalid. Set TODOIST_API_TOKEN and restart the bot.";
  }

  if (status === 403) {
    return "Todoist API access denied for this token/project.";
  }

  if (status === 404) {
    return "Todoist TODO project was not found.";
  }

  if (status === 410) {
    return "Todoist endpoint is deprecated/removed (HTTP 410).";
  }

  return message;
};

const isTodoistTimeoutError = (err: any): boolean => {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "").toLowerCase();
  return code === "ECONNABORTED" || message.includes("timeout");
};

const listTodoistV1Paginated = async <T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T[]> => {
  const rows: T[] = [];
  let cursor: string | null | undefined = undefined;

  for (let page = 0; page < 50; page += 1) {
    const response = await todoistClient.get(path, {
      headers: getTodoistAuthHeaders(),
      params: {
        ...params,
        cursor: cursor ?? undefined,
        limit: 200,
      },
    });
    const payload = response.data as ITodoistPaginatedResponse<T> | T[] | null | undefined;
    if (Array.isArray(payload)) {
      rows.push(...payload);
      break;
    }

    const pageResults = payload?.results ?? payload?.items ?? [];
    rows.push(...pageResults);
    cursor = payload?.next_cursor ?? null;
    if (!cursor) {
      break;
    }
  }

  return rows;
};

const getProjectById = async (projectId: string): Promise<ITodoistProject | null> => {
  try {
    const response = await todoistClient.get<ITodoistProject>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      { headers: getTodoistAuthHeaders() },
    );
    return response.data ?? null;
  } catch (err: any) {
    if (Number(err?.response?.status ?? 0) === 404) {
      return null;
    }
    throw err;
  }
};

const listProjectSections = async (projectId: string): Promise<ITodoistSection[]> => {
  return listTodoistV1Paginated<ITodoistSection>("/api/v1/sections", {
    project_id: projectId,
  });
};

const listActiveProjectTasks = async (projectId: string): Promise<ITodoistTask[]> => {
  return listTodoistV1Paginated<ITodoistTask>("/api/v1/tasks", {
    project_id: projectId,
  });
};

const listProjectCollaborators = async (projectId: string): Promise<ITodoistCollaborator[]> => {
  try {
    return listTodoistV1Paginated<ITodoistCollaborator>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/collaborators`,
    );
  } catch (err: any) {
    if (
      Number(err?.response?.status ?? 0) === 403 ||
      Number(err?.response?.status ?? 0) === 404 ||
      Number(err?.response?.status ?? 0) === 410
    ) {
      return [];
    }
    throw err;
  }
};

const getOrCreateSection = (
  sections: Map<string, ISectionSnapshot>,
  sectionId: string,
  fallbackName: string,
  fallbackOrder: number,
): ISectionSnapshot => {
  const existing = sections.get(sectionId);
  if (existing) {
    return existing;
  }

  const created: ISectionSnapshot = {
    completedItems: [],
    name: fallbackName,
    neededItems: [],
    order: fallbackOrder,
    sectionId,
    taskOptions: [],
  };
  sections.set(sectionId, created);
  return created;
};

const sortPreparedTasks = (a: IPreparedTodoTask, b: IPreparedTodoTask): number => {
  const aHasDue = a.dueLabel.length > 0;
  const bHasDue = b.dueLabel.length > 0;
  if (aHasDue !== bHasDue) {
    return aHasDue ? -1 : 1;
  }
  return a.order - b.order || a.text.localeCompare(b.text);
};

const buildTaskSelectLabel = (task: IPreparedTodoTask): string => {
  const prefix = task.depth > 0 ? `${"↳ ".repeat(Math.min(task.depth, 3))}` : "";
  const duePrefix = task.dueLabel ? `[${task.dueLabel}] ` : "";
  return `${prefix}${duePrefix}${task.text}`.slice(0, 100);
};

const buildSectionTaskData = (tasks: IPreparedTodoTask[]): {
  lines: string[];
  options: ISectionTaskOption[];
} => {
  if (!tasks.length) {
    return { lines: [], options: [] };
  }

  const byId = new Map<string, IPreparedTodoTask>();
  const childMap = new Map<string, IPreparedTodoTask[]>();
  const roots: IPreparedTodoTask[] = [];

  for (const task of tasks) {
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    if (task.parentId && byId.has(task.parentId)) {
      const children = childMap.get(task.parentId) ?? [];
      children.push(task);
      childMap.set(task.parentId, children);
      continue;
    }
    roots.push(task);
  }

  roots.sort(sortPreparedTasks);
  for (const children of childMap.values()) {
    children.sort(sortPreparedTasks);
  }

  const dueLabelWidth = tasks.reduce((maxWidth, task) => {
    return Math.max(maxWidth, task.dueLabel.length);
  }, 0);

  const formatTaskLine = (task: IPreparedTodoTask, depth: number): string => {
    if (depth > 0 || dueLabelWidth <= 0 || !task.dueLabel) {
      return task.text;
    }
    const paddedDueLabel = task.dueLabel.padEnd(dueLabelWidth, " ");
    return `\`${paddedDueLabel}\`⠀${task.text}`;
  };

  const lines: string[] = [];
  const options: ISectionTaskOption[] = [];
  const visited = new Set<string>();

  const walk = (task: IPreparedTodoTask, depth: number): void => {
    if (visited.has(task.id)) {
      return;
    }
    visited.add(task.id);

    task.depth = depth;
    lines.push(`${"  ".repeat(depth)}- ${formatTaskLine(task, depth)}`);
    if (task.completableId && options.length < MIKE_TODO_COMPLETE_SELECT_OPTION_LIMIT) {
      options.push({
        label: buildTaskSelectLabel(task),
        value: task.completableId,
      });
    }
    const children = childMap.get(task.id) ?? [];
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  for (const task of tasks.sort(sortPreparedTasks)) {
    if (!visited.has(task.id)) {
      walk(task, 0);
    }
  }

  return { lines, options };
};

const buildTodoListData = (
  project: ITodoistProject,
  sections: ITodoistSection[],
  activeTasks: ITodoistTask[],
  collaborators: ITodoistCollaborator[],
): IMikeTodoListData => {
  const sectionMap = new Map<string, ISectionSnapshot>();
  const preparedBySection = new Map<string, IPreparedTodoTask[]>();
  const collaboratorNames = new Map<string, string>();
  const rootSectionId = "root";
  const rootSectionName = "General";

  for (const collaborator of collaborators) {
    const id = String(collaborator.id ?? "");
    const name = normalizeItemText(collaborator.name ?? "");
    if (!id || !name) {
      continue;
    }
    collaboratorNames.set(id, name);
  }

  for (const section of sections) {
    const sectionId = String(section.id ?? "");
    if (!sectionId) {
      continue;
    }
    sectionMap.set(sectionId, {
      completedItems: [],
      name: normalizeItemText(section.name ?? "") || "Untitled",
      neededItems: [],
      order: Number(section.order ?? 0),
      sectionId,
      taskOptions: [],
    });
  }

  if (!sectionMap.has(rootSectionId)) {
    sectionMap.set(rootSectionId, {
      completedItems: [],
      name: rootSectionName,
      neededItems: [],
      order: Number.MAX_SAFE_INTEGER,
      sectionId: rootSectionId,
      taskOptions: [],
    });
  }

  let sourceUpdatedAt = "";
  let sourceUpdatedById = "";

  for (const task of activeTasks) {
    const text = normalizeItemText(task.content ?? "");
    if (!text) {
      continue;
    }
    const dueLabel = formatTaskDueLabel(task);
    const sectionId = task.section_id ? String(task.section_id) : rootSectionId;
    getOrCreateSection(sectionMap, sectionId, rootSectionName, Number.MAX_SAFE_INTEGER);

    const preparedTasks = preparedBySection.get(sectionId) ?? [];
    const taskId = String(task.id ?? "");
    preparedTasks.push({
      completableId: taskId,
      dueLabel,
      depth: 0,
      id: taskId || `${sectionId}:${preparedTasks.length}:${text}`,
      text,
      order: Number(task.order ?? Number.MAX_SAFE_INTEGER),
      parentId: String(task.parent_id ?? ""),
    });
    preparedBySection.set(sectionId, preparedTasks);

    const createdAt = String(task.created_at ?? "");
    if (createdAt && createdAt > sourceUpdatedAt) {
      sourceUpdatedAt = createdAt;
      sourceUpdatedById = String(task.creator_id ?? "");
    }
  }

  for (const [sectionId, tasks] of preparedBySection) {
    const section = getOrCreateSection(
      sectionMap,
      sectionId,
      rootSectionName,
      Number.MAX_SAFE_INTEGER,
    );
    const taskData = buildSectionTaskData(tasks);
    section.neededItems = taskData.lines;
    section.taskOptions = taskData.options;
  }

  const orderedSections = Array.from(sectionMap.values())
    .filter((section) => section.neededItems.length > 0 || section.completedItems.length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  return {
    listId: String(project.id ?? ""),
    listTitle: String(project.name ?? "Michael's TODO List"),
    sections: orderedSections,
    sourceUpdatedAt: sourceUpdatedAt || undefined,
    sourceUpdatedBy: sourceUpdatedById
      ? (collaboratorNames.get(sourceUpdatedById) ?? `User ${sourceUpdatedById}`)
      : undefined,
  };
};

const getMikeTodoListData = async (): Promise<IMikeTodoListData> => {
  const projectId = TODOIST_CONFIG.mikeTodoProjectId;
  if (!projectId) {
    throw new Error("TODOIST_MIKE_TODO_PROJECT_ID is not configured.");
  }

  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`Todoist project not found. ID="${projectId}".`);
  }

  const [sections, activeTasks, collaborators] = await Promise.all([
    listProjectSections(projectId),
    listActiveProjectTasks(projectId),
    listProjectCollaborators(projectId),
  ]);

  const visibleTasks = activeTasks.filter((task) => shouldRenderTask(task));
  return buildTodoListData(project, sections, visibleTasks, collaborators);
};

const buildSectionContainer = (section: ISectionSnapshot): ContainerBuilder => {
  const normalizedSectionName = normalizeItemText(section.name).toLowerCase();
  const sectionEmojiMap: Record<string, string> = {
    "recurring tasks": ":recycle:",
    work: "<:nys:1470896363670863987>",
    financial: ":dollar:",
    home: ":house:",
    personal: ":bust_in_silhouette:",
    "for others": ":family_adult_adult_child_child:",
    };
  const sectionEmoji = sectionEmojiMap[normalizedSectionName] ?? "🧩";

  const lines: string[] = [`## ${sectionEmoji}⠀${section.name}`];
  lines.push(
    section.neededItems.length > 0
      ? section.neededItems.join("\n")
      : "- none",
  );
  if (section.completedItems.length > 0) {
    lines.push("");
    lines.push("## ✅ Completed");
    lines.push(section.completedItems.map((item) => `- ~~${item}~~`).join("\n"));
  }

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  if (section.taskOptions.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${MIKE_TODO_COMPLETE_SELECT_PREFIX}:${section.sectionId}`)
      .setPlaceholder("Mark a Task complete")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(section.taskOptions);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    container.addActionRowComponents(row);
  }

  return container;
};

const buildTodoListComponents = (
  data: IMikeTodoListData | null,
  syncDate: Date,
  errorText?: string,
): ContainerBuilder[] => {
  const components: ContainerBuilder[] = [];
  const overviewContainer = new ContainerBuilder();
  overviewContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Michael's TODO List"),
  );

  const lastUpdatedLine = `-# Last updated: ${formatTimestampEt(syncDate)}`;

  if (errorText) {
    overviewContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ⚠️ Sync Status\nUnable to sync from Todoist right now.\n${errorText}`,
      ),
    );
    overviewContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lastUpdatedLine),
    );
    components.push(overviewContainer);
    return components;
  }

  overviewContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lastUpdatedLine),
  );
  components.push(overviewContainer);

  if (!data || data.sections.length === 0) {
    components.push(
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "## ✅ Tasks\nNo tasks to show.",
        ),
      ),
    );
    return components;
  }

  for (const section of data.sections) {
    components.push(buildSectionContainer(section));
  }

  return components;
};

const buildFingerprint = (data: IMikeTodoListData | null, errorText?: string): string => {
  if (errorText) return `error:${errorText}`;
  if (!data) return "empty";
  const sectionSummary = data.sections
    .map((section) => [
      section.name,
      section.neededItems.join("|"),
      section.completedItems.join("|"),
    ].join("::"))
    .join("||");
  return [data.listId, data.sourceUpdatedAt ?? "", data.sourceUpdatedBy ?? "", sectionSummary].join(
    "##",
  );
};

const upsertTodoListMessage = async (channelId: string, messageId: string): Promise<void> => {
  await query(
    `
      MERGE INTO CALENDAR_MikeTodoListMessages target
      USING (SELECT :channelId AS CHANNEL_ID, :messageId AS MESSAGE_ID FROM DUAL) source
      ON (target.CHANNEL_ID = source.CHANNEL_ID)
      WHEN MATCHED THEN
        UPDATE SET target.MESSAGE_ID = source.MESSAGE_ID, target.UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CHANNEL_ID, MESSAGE_ID, CREATED_AT, UPDATED_AT)
        VALUES (source.CHANNEL_ID, source.MESSAGE_ID, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    { channelId, messageId },
  );
};

const getTrackedMessageId = async (channelId: string): Promise<string> => {
  const rows = await query<any>(
    `SELECT MESSAGE_ID FROM CALENDAR_MikeTodoListMessages WHERE CHANNEL_ID = :channelId`,
    { channelId },
  );
  if (!rows.length) return "";
  return String(rows[0].MESSAGE_ID ?? "");
};

const ensureTrackedMessage = async (client: Client, channelId: string): Promise<string> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`TODO list channel ${channelId} is unavailable or not text-based.`);
  }

  const trackedMessageId = await getTrackedMessageId(channelId);
  if (!trackedMessageId) {
    const bootstrapPayload = buildTodoListComponents(null, new Date(), "Initial sync pending...");
    const message = await (channel as any).send({
      components: bootstrapPayload,
      flags: MessageFlags.IsComponentsV2,
    });
    await upsertTodoListMessage(channelId, message.id);
    return message.id;
  }

  try {
    await (channel as any).messages.fetch(trackedMessageId);
    return trackedMessageId;
  } catch (err: any) {
    if (err?.code !== 10008) {
      throw err;
    }
  }

  const bootstrapPayload = buildTodoListComponents(
    null,
    new Date(),
    "Tracked message was missing. Recreated by bot.",
  );
  const message = await (channel as any).send({
    components: bootstrapPayload,
    flags: MessageFlags.IsComponentsV2,
  });
  await upsertTodoListMessage(channelId, message.id);
  return message.id;
};

const updateTodoListMessage = async (client: Client, channelId: string): Promise<void> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`TODO list channel ${channelId} is unavailable or not text-based.`);
  }

  const messageId = await ensureTrackedMessage(client, channelId);
  let listData: IMikeTodoListData | null = null;
  try {
    listData = await getMikeTodoListData();
  } catch (err: any) {
    const isTimeout = isTodoistTimeoutError(err);
    const summary = summarizeTodoistError(err);
    console.error("[MikeTodoList] Failed to fetch Todoist project; leaving existing message unchanged:", {
      message: err?.message ?? String(err),
      status: err?.response?.status ?? "",
      method: err?.config?.method ?? "",
      url: err?.config?.url ?? "",
      timeout: isTimeout,
      summary,
    });
    return;
  }

  const fingerprint = buildFingerprint(listData);
  const previousFingerprint = lastPayloadFingerprintByChannel.get(channelId) ?? "";
  if (fingerprint === previousFingerprint) {
    return;
  }

  const payload = buildTodoListComponents(listData, new Date());
  const message = await (channel as any).messages.fetch(messageId);
  await message.edit({
    components: payload,
    flags: MessageFlags.IsComponentsV2,
  });
  lastPayloadFingerprintByChannel.set(channelId, fingerprint);
};

export const runMikeTodoListSync = async (client: Client, channelId: string): Promise<void> => {
  if (todoSyncInProgress.has(channelId)) {
    return;
  }

  todoSyncInProgress.add(channelId);
  try {
    await updateTodoListMessage(client, channelId);
  } finally {
    todoSyncInProgress.delete(channelId);
  }
};

export const completeMikeTodoTask = async (
  client: Client,
  channelId: string,
  taskId: string,
): Promise<void> => {
  if (!taskId) {
    throw new Error("Task id is required.");
  }

  await todoistClient.post(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/close`,
    undefined,
    { headers: getTodoistAuthHeaders() },
  );

  lastPayloadFingerprintByChannel.delete(channelId);
  await updateTodoListMessage(client, channelId);
};

export const MIKE_TODO_COMPLETE_SELECT_REGEX = /^mike-todo-complete:[^:]+$/;

export const startMikeTodoListSyncService = (
  client: Client,
  channelResolver: ChannelResolver,
): void => {
  if (todoTimer) {
    return;
  }

  const resolveChannels = async (): Promise<string[]> => {
    if (typeof channelResolver === "string") {
      return [channelResolver];
    }
    const ids = await channelResolver();
    return Array.from(new Set(ids.filter(Boolean)));
  };

  const run = async (): Promise<void> => {
    try {
      const channelIds = await resolveChannels();
      for (const channelId of channelIds) {
        await runMikeTodoListSync(client, channelId);
      }
    } catch (err) {
      console.error("[MikeTodoList] Sync loop failed:", err);
    }
  };

  void run();
  todoTimer = setInterval(() => {
    void run();
  }, TODO_SYNC_INTERVAL_MS);
};
