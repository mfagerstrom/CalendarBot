import axios from "axios";
import {
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { MessageFlags } from "discord.js";
import type { Client } from "discordx";
import { TODOIST_CONFIG } from "../config/todoist.js";
import { query } from "../lib/db/oracle.js";

const REMINDER_TIMEZONE = "America/New_York";
const GROCERY_SYNC_INTERVAL_MS = 60 * 1000;
const TODOIST_API_BASE_URL = "https://api.todoist.com";
const TODOIST_COMPLETED_LIMIT = 200;
const COMPLETED_ITEM_RETENTION_MS = 2 * 60 * 60 * 1000;

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
  id: string;
  is_completed?: boolean;
  section_id?: string;
}

interface ITodoistCompletedItem {
  completed_at?: string;
  completed_by_id?: string | number;
  completed_by_uid?: string | number;
  content?: string;
  section_id?: string;
}

interface ITodoistCompletedResponse {
  items?: ITodoistCompletedItem[];
}

interface ITodoistCollaborator {
  id?: string | number;
  name?: string;
}

interface ICompletedItemSnapshot {
  completedAt?: string;
  text: string;
}

interface ISectionSnapshot {
  completedItems: ICompletedItemSnapshot[];
  name: string;
  neededItems: string[];
  order: number;
}

interface IGroceryListData {
  listId: string;
  listTitle: string;
  sections: ISectionSnapshot[];
  sourceUpdatedAt?: string;
  sourceUpdatedBy?: string;
}

let groceryTimer: NodeJS.Timeout | null = null;
let grocerySyncInProgress = false;
let lastPayloadFingerprint = "";
let cachedProjectId = TODOIST_CONFIG.groceryProjectId;

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

const isCompletedWithinRetentionWindow = (completedAtRaw?: string): boolean => {
  if (!completedAtRaw) {
    return false;
  }

  const completedAt = new Date(completedAtRaw);
  if (Number.isNaN(completedAt.getTime())) {
    return false;
  }

  const ageMs = Date.now() - completedAt.getTime();
  return ageMs >= 0 && ageMs <= COMPLETED_ITEM_RETENTION_MS;
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
    return "Todoist grocery project was not found.";
  }

  return message;
};

const isTodoistTimeoutError = (err: any): boolean => {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "").toLowerCase();
  return code === "ECONNABORTED" || message.includes("timeout");
};

const listTodoistProjects = async (): Promise<ITodoistProject[]> => {
  const response = await todoistClient.get<ITodoistProject[]>("/rest/v2/projects", {
    headers: getTodoistAuthHeaders(),
  });
  return response.data ?? [];
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

const findProjectByName = async (name: string): Promise<ITodoistProject | null> => {
  const normalizedTarget = normalizeItemText(name).toLowerCase();
  const projects = await listTodoistProjects();
  const match = projects.find(
    (project) => normalizeItemText(project.name ?? "").toLowerCase() === normalizedTarget,
  );
  return match ?? null;
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

const listCompletedProjectTasks = async (projectId: string): Promise<ITodoistCompletedItem[]> => {
  try {
    const response = await todoistClient.get<ITodoistCompletedResponse>(
      "/sync/v9/completed/get_all",
      {
        headers: getTodoistAuthHeaders(),
        params: {
          limit: TODOIST_COMPLETED_LIMIT,
          project_id: projectId,
        },
      },
    );
    return response.data?.items ?? [];
  } catch (err: any) {
    // Completed endpoint can be unavailable for some plans or token scopes.
    if (Number(err?.response?.status ?? 0) === 404) {
      return [];
    }
    throw err;
  }
};

const listProjectCollaborators = async (projectId: string): Promise<ITodoistCollaborator[]> => {
  try {
    const response = await todoistClient.get<ITodoistCollaborator[]>(
      `/rest/v2/projects/${encodeURIComponent(projectId)}/collaborators`,
      { headers: getTodoistAuthHeaders() },
    );
    return response.data ?? [];
  } catch (err: any) {
    if (Number(err?.response?.status ?? 0) === 403 || Number(err?.response?.status ?? 0) === 404) {
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

const buildGroceryListData = (
  project: ITodoistProject,
  sections: ITodoistSection[],
  activeTasks: ITodoistTask[],
  completedItems: ITodoistCompletedItem[],
  collaborators: ITodoistCollaborator[],
): IGroceryListData => {
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
    const sectionId = task.section_id ? String(task.section_id) : rootSectionId;
    const section = getOrCreateSection(
      sectionMap,
      sectionId,
      rootSectionName,
      Number.MAX_SAFE_INTEGER,
    );
    section.neededItems.push(text);

    const createdAt = String(task.created_at ?? "");
    if (createdAt && createdAt > sourceUpdatedAt) {
      sourceUpdatedAt = createdAt;
      sourceUpdatedById = String(task.creator_id ?? "");
    }
  }

  for (const item of completedItems) {
    const text = normalizeItemText(item.content ?? "");
    if (!text) {
      continue;
    }
    const completedAt = String(item.completed_at ?? "");
    if (!isCompletedWithinRetentionWindow(completedAt)) {
      continue;
    }
    const sectionId = item.section_id ? String(item.section_id) : rootSectionId;
    const section = getOrCreateSection(
      sectionMap,
      sectionId,
      rootSectionName,
      Number.MAX_SAFE_INTEGER,
    );
    section.completedItems.push({
      completedAt: completedAt || undefined,
      text,
    });

    if (completedAt && completedAt > sourceUpdatedAt) {
      sourceUpdatedAt = completedAt;
      sourceUpdatedById = String(item.completed_by_id ?? item.completed_by_uid ?? "");
    }
  }

  const orderedSections = Array.from(sectionMap.values())
    .filter((section) => section.neededItems.length > 0 || section.completedItems.length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  return {
    listId: String(project.id ?? ""),
    listTitle: String(project.name ?? TODOIST_CONFIG.groceryProjectName),
    sections: orderedSections,
    sourceUpdatedAt: sourceUpdatedAt || undefined,
    sourceUpdatedBy: sourceUpdatedById
      ? (collaboratorNames.get(sourceUpdatedById) ?? `User ${sourceUpdatedById}`)
      : undefined,
  };
};

const getGroceryListData = async (): Promise<IGroceryListData> => {
  const configuredProjectId = TODOIST_CONFIG.groceryProjectId || cachedProjectId;
  let project: ITodoistProject | null = null;

  if (configuredProjectId) {
    project = await getProjectById(configuredProjectId);
  }

  if (!project) {
    project = await findProjectByName(TODOIST_CONFIG.groceryProjectName);
  }

  if (!project) {
    throw new Error(
      `Todoist project not found. Name="${TODOIST_CONFIG.groceryProjectName}" ` +
      `ID="${configuredProjectId || "(none)"}".`,
    );
  }

  const projectId = String(project.id ?? "");
  if (!projectId) {
    throw new Error("Todoist project ID was empty.");
  }

  const [sections, activeTasks, completedItems, collaborators] = await Promise.all([
    listProjectSections(projectId),
    listActiveProjectTasks(projectId),
    listCompletedProjectTasks(projectId),
    listProjectCollaborators(projectId),
  ]);

  const data = buildGroceryListData(project, sections, activeTasks, completedItems, collaborators);
  if (!TODOIST_CONFIG.groceryProjectId && data.listId) {
    cachedProjectId = data.listId;
  }
  return data;
};

const buildSectionMarkdown = (section: ISectionSnapshot): string => {
  const normalizedSectionName = normalizeItemText(section.name).toLowerCase();
  const sectionEmojiMap: Record<string, string> = {
    "bread aisle": ":bread:",
    "dairy aisle": ":cheese:",
    "dry goods aisles": ":canned_food:",
    "frozen aisles": ":ice_cream:",
    "meat aisle": ":cut_of_meat:",
    "pharmacy area": ":pill:",
    "produce section": ":apple:",
  };
  const sectionEmoji = sectionEmojiMap[normalizedSectionName] ?? ":shopping_basket:";

  const lines: string[] = [`## ${sectionEmoji}⠀${section.name}`];

  if (section.neededItems.length > 0) {
    lines.push(section.neededItems.map((item) => `- ${item}`).join("\n"));
  } else if (section.completedItems.length === 0) {
    lines.push("- none");
  }

  if (section.completedItems.length > 0) {
    lines.push(section.completedItems.map((item) => `- ~~${item.text}~~`).join("\n"));
  }

  return lines.join("\n");
};

const buildSectionContainer = (section: ISectionSnapshot): ContainerBuilder => {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(buildSectionMarkdown(section)),
  );
};

const buildInstructionsContainer = (): ContainerBuilder => {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Instructions\n" +
      "1. Download Todoist on your phone:\n" +
      "https://play.google.com/store/apps/details?id=com.todoist\n" +
      "2. Open Todoist and create an account using your Google account.\n" +
      "3. Check your Todoist inbox and accept the invite to the **Family Grocery List** project from **Mike**.",
    ),
  );
};

const buildGroceryListComponents = (
  data: IGroceryListData | null,
  syncDate: Date,
  errorText?: string,
): ContainerBuilder[] => {
  const components: ContainerBuilder[] = [];

  const overviewContainer = new ContainerBuilder();
  overviewContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Family Grocery List"),
  );

  const lastUpdatedLine = data?.sourceUpdatedBy
    ? `-# Last updated: ${formatTimestampEt(syncDate)} · Last list change by: ${data.sourceUpdatedBy}`
    : `-# Last updated: ${formatTimestampEt(syncDate)}`;

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
    components.push(buildInstructionsContainer());
    return components;
  }

  overviewContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lastUpdatedLine),
  );
  components.push(overviewContainer);

  if (!data || data.sections.length === 0) {
    components.push(
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## 🧺 Sections\nNo grocery items found."),
      ),
    );
    components.push(buildInstructionsContainer());
    return components;
  }

  for (const section of data.sections) {
    components.push(buildSectionContainer(section));
  }

  components.push(buildInstructionsContainer());

  return components;
};

const buildFingerprint = (data: IGroceryListData | null, errorText?: string): string => {
  if (errorText) return `error:${errorText}`;
  if (!data) return "empty";
  const sectionSummary = data.sections
    .map((section) => [
      section.name,
      section.neededItems.join("|"),
      section.completedItems.map((item) => `${item.text}:${item.completedAt ?? ""}`).join("|"),
    ].join("::"))
    .join("||");
  return [
    data.listId,
    data.sourceUpdatedAt ?? "",
    sectionSummary,
  ].join("##");
};

const upsertGroceryListMessage = async (
  channelId: string,
  messageId: string,
): Promise<void> => {
  await query(
    `
      MERGE INTO CALENDAR_GroceryListMessages target
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
    `SELECT MESSAGE_ID FROM CALENDAR_GroceryListMessages WHERE CHANNEL_ID = :channelId`,
    { channelId },
  );
  if (!rows.length) return "";
  return String(rows[0].MESSAGE_ID ?? "");
};

const ensureTrackedMessage = async (client: Client, channelId: string): Promise<string> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Grocery list channel ${channelId} is unavailable or not text-based.`);
  }

  const trackedMessageId = await getTrackedMessageId(channelId);
  if (!trackedMessageId) {
    const bootstrapPayload = buildGroceryListComponents(
      null,
      new Date(),
      "Initial sync pending...",
    );
    const message = await (channel as any).send({
      components: bootstrapPayload,
      flags: MessageFlags.IsComponentsV2,
    });
    await upsertGroceryListMessage(channelId, message.id);
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

  const bootstrapPayload = buildGroceryListComponents(
    null,
    new Date(),
    "Tracked message was missing. Recreated by bot.",
  );
  const newMessage = await (channel as any).send({
    components: bootstrapPayload,
    flags: MessageFlags.IsComponentsV2,
  });
  await upsertGroceryListMessage(channelId, newMessage.id);
  return newMessage.id;
};

const updateGroceryListMessage = async (client: Client, channelId: string): Promise<void> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Grocery list channel ${channelId} is unavailable or not text-based.`);
  }

  const messageId = await ensureTrackedMessage(client, channelId);

  let listData: IGroceryListData | null = null;
  let errorText = "";
  try {
    listData = await getGroceryListData();
  } catch (err: any) {
    if (isTodoistTimeoutError(err)) {
      console.warn("[GroceryList] Todoist sync timed out. Keeping existing static post.");
      return;
    }

    errorText = summarizeTodoistError(err);
    console.error("[GroceryList] Failed to fetch Todoist project:", {
      message: err?.message ?? String(err),
      status: err?.response?.status ?? "",
      summary: errorText,
    });
  }

  const fingerprint = buildFingerprint(listData, errorText);
  if (fingerprint === lastPayloadFingerprint && !errorText) {
    return;
  }

  const payload = buildGroceryListComponents(
    listData,
    new Date(),
    errorText || undefined,
  );
  const message = await (channel as any).messages.fetch(messageId);
  await message.edit({
    components: payload,
    flags: MessageFlags.IsComponentsV2,
  });
  lastPayloadFingerprint = fingerprint;
};

export const runGroceryListSync = async (
  client: Client,
  channelId: string,
): Promise<void> => {
  if (grocerySyncInProgress) {
    return;
  }

  grocerySyncInProgress = true;
  try {
    await updateGroceryListMessage(client, channelId);
  } finally {
    grocerySyncInProgress = false;
  }
};

export const startGroceryListSyncService = (
  client: Client,
  channelId: string,
): void => {
  if (groceryTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await runGroceryListSync(client, channelId);
    } catch (err) {
      console.error("[GroceryList] Sync loop failed:", err);
    }
  };

  void run();
  groceryTimer = setInterval(() => {
    void run();
  }, GROCERY_SYNC_INTERVAL_MS);
};
