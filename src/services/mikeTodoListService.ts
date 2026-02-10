import axios from "axios";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { MessageFlags } from "discord.js";
import type { Client } from "discordx";
import { TODOIST_CONFIG } from "../config/todoist.js";
import { query } from "../lib/db/oracle.js";

const REMINDER_TIMEZONE = "America/New_York";
const TODO_SYNC_INTERVAL_MS = 60 * 1000;
const TODOIST_API_BASE_URL = "https://api.todoist.com";

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
  content?: string;
  created_at?: string;
  creator_id?: string | number;
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

interface ISectionSnapshot {
  completedItems: string[];
  name: string;
  neededItems: string[];
  order: number;
}

interface IMikeTodoListData {
  listId: string;
  listTitle: string;
  sections: ISectionSnapshot[];
  sourceUpdatedAt?: string;
  sourceUpdatedBy?: string;
}

let todoTimer: NodeJS.Timeout | null = null;
let todoSyncInProgress = false;
let lastPayloadFingerprint = "";

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

const formatTimeInEt = (date: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: REMINDER_TIMEZONE,
  }).format(date);
};

const formatWeekdayDateInEt = (date: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: REMINDER_TIMEZONE,
  }).format(date);
};

const formatTaskDueLabel = (task: ITodoistTask): string => {
  const now = new Date();
  const todayYmd = formatYmdInTimezone(now, REMINDER_TIMEZONE);
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYmd = formatYmdInTimezone(tomorrow, REMINDER_TIMEZONE);

  const dueDateTime = String(task.due?.datetime ?? "");
  const dueDate = String(task.due?.date ?? "");

  if (dueDateTime) {
    const parsed = new Date(dueDateTime);
    if (!Number.isNaN(parsed.getTime())) {
      const dueYmd = formatYmdInTimezone(parsed, REMINDER_TIMEZONE);
      const dueTime = formatTimeInEt(parsed);

      if (dueYmd === todayYmd) {
        return dueTime;
      }

      if (dueYmd === tomorrowYmd) {
        return `Tomorrow ${dueTime}`;
      }

      return `${formatWeekdayDateInEt(parsed)} ${dueTime}`;
    }
  }

  if (!dueDate) {
    return "";
  }

  if (dueDate === todayYmd) {
    return "Today";
  }

  if (dueDate === tomorrowYmd) {
    return "Tomorrow";
  }

  const parsedDate = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return dueDate;
  }

  return formatWeekdayDateInEt(parsedDate);
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

  return message;
};

const isTodoistTimeoutError = (err: any): boolean => {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "").toLowerCase();
  return code === "ECONNABORTED" || message.includes("timeout");
};

const getProjectById = async (projectId: string): Promise<ITodoistProject | null> => {
  try {
    const response = await todoistClient.get<ITodoistProject>(
      `/rest/v2/projects/${encodeURIComponent(projectId)}`,
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
  const response = await todoistClient.get<ITodoistSection[]>("/rest/v2/sections", {
    headers: getTodoistAuthHeaders(),
    params: { project_id: projectId },
  });
  return response.data ?? [];
};

const listActiveProjectTasks = async (projectId: string): Promise<ITodoistTask[]> => {
  const response = await todoistClient.get<ITodoistTask[]>("/rest/v2/tasks", {
    headers: getTodoistAuthHeaders(),
    params: { project_id: projectId },
  });
  return response.data ?? [];
};

const listProjectCollaborators = async (projectId: string): Promise<ITodoistCollaborator[]> => {
  try {
    const response = await todoistClient.get<ITodoistCollaborator[]>(
      `/rest/v2/projects/${encodeURIComponent(projectId)}/collaborators`,
      { headers: getTodoistAuthHeaders() },
    );
    return response.data ?? [];
  } catch (err: any) {
    if (
      Number(err?.response?.status ?? 0) === 403 ||
      Number(err?.response?.status ?? 0) === 404
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
  };
  sections.set(sectionId, created);
  return created;
};

const buildTodoListData = (
  project: ITodoistProject,
  sections: ITodoistSection[],
  activeTasks: ITodoistTask[],
  collaborators: ITodoistCollaborator[],
): IMikeTodoListData => {
  const sectionMap = new Map<string, ISectionSnapshot>();
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
    });
  }

  if (!sectionMap.has(rootSectionId)) {
    sectionMap.set(rootSectionId, {
      completedItems: [],
      name: rootSectionName,
      neededItems: [],
      order: Number.MAX_SAFE_INTEGER,
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
    const displayText = dueLabel
      ? `${text}\n-# ⠀⠀Due ${dueLabel}`
      : text;
    const sectionId = task.section_id ? String(task.section_id) : rootSectionId;
    const section = getOrCreateSection(
      sectionMap,
      sectionId,
      rootSectionName,
      Number.MAX_SAFE_INTEGER,
    );
    section.neededItems.push(displayText);

    const createdAt = String(task.created_at ?? "");
    if (createdAt && createdAt > sourceUpdatedAt) {
      sourceUpdatedAt = createdAt;
      sourceUpdatedById = String(task.creator_id ?? "");
    }
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
      ? section.neededItems.map((item) => `- ${item}`).join("\n")
      : "- none",
  );
  if (section.completedItems.length > 0) {
    lines.push("");
    lines.push("### ✅ Completed");
    lines.push(section.completedItems.map((item) => `- ~~${item}~~`).join("\n"));
  }

  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
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
  let errorText = "";
  try {
    listData = await getMikeTodoListData();
  } catch (err: any) {
    if (isTodoistTimeoutError(err)) {
      console.warn("[MikeTodoList] Todoist sync timed out. Keeping existing static post.");
      return;
    }

    errorText = summarizeTodoistError(err);
    console.error("[MikeTodoList] Failed to fetch Todoist project:", {
      message: err?.message ?? String(err),
      status: err?.response?.status ?? "",
      summary: errorText,
    });
  }

  const fingerprint = buildFingerprint(listData, errorText);
  if (fingerprint === lastPayloadFingerprint && !errorText) {
    return;
  }

  const payload = buildTodoListComponents(listData, new Date(), errorText || undefined);
  const message = await (channel as any).messages.fetch(messageId);
  await message.edit({
    components: payload,
    flags: MessageFlags.IsComponentsV2,
  });
  lastPayloadFingerprint = fingerprint;
};

export const runMikeTodoListSync = async (client: Client, channelId: string): Promise<void> => {
  if (todoSyncInProgress) {
    return;
  }

  todoSyncInProgress = true;
  try {
    await updateTodoListMessage(client, channelId);
  } finally {
    todoSyncInProgress = false;
  }
};

export const startMikeTodoListSyncService = (client: Client, channelId: string): void => {
  if (todoTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await runMikeTodoListSync(client, channelId);
    } catch (err) {
      console.error("[MikeTodoList] Sync loop failed:", err);
    }
  };

  void run();
  todoTimer = setInterval(() => {
    void run();
  }, TODO_SYNC_INTERVAL_MS);
};
