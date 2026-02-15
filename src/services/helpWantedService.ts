import {
  ActionRowBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { query } from "../lib/db/oracle.js";
import type { Client } from "discordx";

export interface IHelpWantedRequest {
  id: number;
  requesterId: string;
  requesterLabel?: string | null;
  roleIds: string[];
  description: string;
  createdAt?: Date | null;
}

interface IHelpWantedRequestRow {
  ID: number | string;
  REQUESTER_USER_ID: string | null;
  REQUESTER_LABEL: string | null;
  ROLE_IDS: string | null;
  DESCRIPTION: string | null;
  CREATED_AT: Date | string | null;
}

export interface IHelpWantedCompletion {
  requestId: number;
  requesterId: string;
  requesterLabel?: string | null;
  roleIds: string[];
  requestDescription: string;
  completedByUserId: string;
  completionDescription: string;
}

const normalizeDescription = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;

  if (/^please\b/i.test(normalized)) {
    return normalized;
  }

  const firstChar = normalized[0] ?? "";
  const rest = normalized.slice(1);
  const lowercased = `${firstChar.toLowerCase()}${rest}`;
  return `Please ${lowercased}`;
};

const uniqueRoleIds = (roleIds: string[]): string[] => {
  return Array.from(new Set(roleIds.map((id) => id.trim()).filter(Boolean)));
};

const mapHelpWantedRow = (row: IHelpWantedRequestRow): IHelpWantedRequest => ({
  id: Number(row.ID),
  requesterId: String(row.REQUESTER_USER_ID ?? ""),
  requesterLabel: row.REQUESTER_LABEL ? String(row.REQUESTER_LABEL) : null,
  roleIds: uniqueRoleIds(String(row.ROLE_IDS ?? "").split(",")),
  description: String(row.DESCRIPTION ?? ""),
  createdAt: row.CREATED_AT ? new Date(row.CREATED_AT) : null,
});

export const addHelpWantedRequest = async (
  requesterId: string,
  description: string,
  roleIds: string[],
  requesterLabel?: string | null,
): Promise<void> => {
  const normalizedDescription = normalizeDescription(description);
  const roles = uniqueRoleIds(roleIds);
  const normalizedLabel = normalizeDescription(requesterLabel ?? "");

  await query(
    `
      INSERT INTO CALENDAR_HelpWantedRequests (
        requester_user_id,
        requester_label,
        role_ids,
        description,
        created_at,
        updated_at
      ) VALUES (
        :requesterId,
        :requesterLabel,
        :roleIds,
        :description,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    {
      requesterId,
      requesterLabel: normalizedLabel || null,
      roleIds: roles.join(","),
      description: normalizedDescription,
    },
  );
};

export const listHelpWantedRequests = async (): Promise<IHelpWantedRequest[]> => {
  const rows = await query<IHelpWantedRequestRow>(
    `
      SELECT
        id,
        requester_user_id,
        requester_label,
        role_ids,
        description,
        created_at
      FROM CALENDAR_HelpWantedRequests
      ORDER BY created_at DESC
    `,
  );

  return rows.map(mapHelpWantedRow);
};

export const getHelpWantedRequestById = async (
  id: number,
): Promise<IHelpWantedRequest | null> => {
  const rows = await query<IHelpWantedRequestRow>(
    `
      SELECT
        id,
        requester_user_id,
        requester_label,
        role_ids,
        description,
        created_at
      FROM CALENDAR_HelpWantedRequests
      WHERE id = :id
    `,
    { id },
  );

  if (!rows.length) {
    return null;
  }

  return mapHelpWantedRow(rows[0]);
};

export const removeHelpWantedRequest = async (id: number): Promise<void> => {
  await query(
    "DELETE FROM CALENDAR_HelpWantedRequests WHERE id = :id",
    { id },
  );
};

const formatRoleNames = (roleIds: string[]): string => {
  if (!roleIds.length) return "none";
  return roleIds.map((id) => `<@&${id}>`).join(" / ");
};

const formatRoleNamesPlain = (
  roleIds: string[],
  roleNameLookup: (id: string) => string,
): string => {
  if (!roleIds.length) return "none";
  const names = roleIds.map((id) => roleNameLookup(id)).filter(Boolean);
  return names.length > 0 ? names.join(" / ") : "unknown roles";
};

const formatRequesterLabel = (requesterId: string): string => {
  return `<@${requesterId}>`;
};

const formatRequesterLabelPlain = (
  requesterId: string,
  userLookup: (id: string) => string,
): string => {
  const name = userLookup(requesterId);
  return name || "Unknown User";
};

export const buildHelpWantedListComponents = (
  requests: IHelpWantedRequest[],
  requesterNameLookup: (id: string) => string,
  roleNameLookup: (id: string) => string,
): {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  debugSelectIds: string[];
} => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Help Wanted!"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  if (!requests.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No help requests yet."),
    );
    return { components: [container], debugSelectIds: [] };
  }

  const grouped = new Map<string, {
    label: string;
    lines: string[];
    requesterId: string;
    requests: IHelpWantedRequest[];
  }>();
  for (const request of requests) {
    const description = normalizeDescription(request.description);
    const roleNames = formatRoleNames(request.roleIds);
    const requesterLabel = formatRequesterLabel(request.requesterId);
    const requestText = description || "(No description provided)";
    const line = `- ${roleNames}: ${requestText}`;
    const key = request.requesterId;
    const existing = grouped.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.requests.push(request);
    } else {
      grouped.set(key, {
        label: requesterLabel,
        lines: [line],
        requesterId: request.requesterId,
        requests: [request],
      });
    }
  }

  const priorityRequesterIds = [
    "715699384687525950",
    "715692681883418755",
    "191938640413327360",
    "1461031185021927564",
  ];

  const groups = Array.from(grouped.values()).sort((a, b) => {
    const aPriority = priorityRequesterIds.indexOf(a.requesterId);
    const bPriority = priorityRequesterIds.indexOf(b.requesterId);
    const aIsPriority = aPriority !== -1;
    const bIsPriority = bPriority !== -1;
    if (aIsPriority && bIsPriority) {
      return aPriority - bPriority;
    }
    if (aIsPriority) return -1;
    if (bIsPriority) return 1;

    const aKey = normalizeDescription(a.label);
    const bKey = normalizeDescription(b.label);
    return aKey.localeCompare(bKey, "en", { sensitivity: "base" });
  });
  groups.forEach((group, index) => {
    const requestText: string = group.label === "All of Us" ? "request" : "requests";
    const content = [`**${group.label} ${requestText}:**`, ...group.lines].join("\n");
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (index < groups.length - 1) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }
  });

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# How to add a request: use `/help request`\n" +
      "-# `description` (required): what you need help with, written in plain words.\n" +
      "-# `role_1` (required): the first group of people to notify (for example, a team role).\n",
    ),
  );

  const components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>> = [
    container,
  ];
  const debugSelectIds: string[] = [];

  if (requests.length > 0) {
    const duplicateCounter = new Map<string, number>();
    for (const group of groups) {
      const requestLabel = formatRequesterLabelPlain(
        group.requesterId,
        requesterNameLookup,
      );
      const groupOptions = group.requests.map((request) => {
        const description = normalizeDescription(request.description) || "(No description provided)";
        const roleNames = formatRoleNamesPlain(request.roleIds, roleNameLookup);
        const label = `${roleNames}, ${description}`;
        return {
          label: label.length > 100 ? label.slice(0, 100) : label,
          value: String(request.id),
        };
      });

      if (!groupOptions.length) {
        continue;
      }

      const slugLabel = requestLabel
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)
        .toLowerCase();
      const baseId = `help-complete:${group.requesterId}:${slugLabel}`;
      const count = (duplicateCounter.get(baseId) ?? 0) + 1;
      duplicateCounter.set(baseId, count);
      const customId = count === 1 ? baseId : `${baseId}:${count}`;

      const select = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(`Mark one of ${requestLabel}'s requests complete...`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(groupOptions);

      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
      debugSelectIds.push(customId);
    }
  }

  return { components, debugSelectIds };
};

export const upsertHelpWantedMessage = async (
  channelId: string,
  messageId: string,
): Promise<void> => {
  await query(
    `
      MERGE INTO CALENDAR_HelpWantedMessages target
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

export const ensureHelpWantedMessage = async (
  client: Client,
  channelId: string,
): Promise<void> => {
  const rows = await query<any>(
    `SELECT MESSAGE_ID FROM CALENDAR_HelpWantedMessages WHERE CHANNEL_ID = :channelId`,
    { channelId },
  );

  const existingMessageId = rows.length > 0 ? String(rows[0].MESSAGE_ID) : "";
  let needsCreation = !existingMessageId;

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  if (existingMessageId) {
    try {
      await channel.messages.fetch(existingMessageId);
    } catch (err: any) {
      if (err.code === 10008) {
        needsCreation = true;
      } else {
        throw err;
      }
    }
  }

  const requests = await listHelpWantedRequests();
  const guild = channel.isTextBased() ? (channel as any).guild : null;
  const roleNameLookup = (id: string): string => {
    if (!guild) return "";
    const role = guild.roles?.cache?.get(id);
    return role ? role.name : "";
  };
  const userLookup = (id: string): string => {
    if (!guild) return "";
    const member = guild.members?.cache?.get(id);
    const displayName = member?.displayName ?? "";
    if (displayName) return displayName;
    const user = client.users?.cache?.get(id);
    const username = user?.username ?? "";
    return username;
  };
  const overrideUserNames = new Map<string, string>([
    ["715692681883418755", "Leah"],
    ["715699384687525950", "Eve"],
    ["191938640413327360", "Mike"],
  ]);
  const payload = buildHelpWantedListComponents(
    requests,
    (id) => overrideUserNames.get(id) ?? userLookup(id),
    roleNameLookup,
  );
  if (payload.debugSelectIds && payload.debugSelectIds.length > 0) {
    const uniqueIds = new Set(payload.debugSelectIds);
    const duplicateIds = payload.debugSelectIds.filter(
      (id) => payload.debugSelectIds.indexOf(id) !== payload.debugSelectIds.lastIndexOf(id),
    );
    console.log(
      "[HelpWanted] select ids:",
      payload.debugSelectIds.join(", "),
    );
    if (duplicateIds.length > 0 || uniqueIds.size !== payload.debugSelectIds.length) {
      console.warn(
        "[HelpWanted] duplicate select ids:",
        Array.from(new Set(duplicateIds)).join(", "),
      );
    }
  }
  const allowedMentions = { parse: [] as string[] };

  if (needsCreation) {
    const message = await (channel as any).send({
      components: payload.components,
      flags: 1 << 15,
      allowedMentions,
    });
    await upsertHelpWantedMessage(channelId, message.id);
    return;
  }

  const message = await (channel as any).messages.fetch(existingMessageId);
  await message.edit({
    components: payload.components,
    flags: 1 << 15,
    allowedMentions,
  });
};

export const addHelpWantedCompletion = async (
  completion: IHelpWantedCompletion,
): Promise<void> => {
  const normalizedCompletionDescription = completion.completionDescription
    .replace(/\s+/g, " ")
    .trim();

  await query(
    `
      INSERT INTO CALENDAR_HelpWantedCompletions (
        request_id,
        requester_user_id,
        requester_label,
        role_ids,
        request_description,
        completed_by_user_id,
        completion_description,
        completed_at,
        created_at
      ) VALUES (
        :requestId,
        :requesterId,
        :requesterLabel,
        :roleIds,
        :requestDescription,
        :completedByUserId,
        :completionDescription,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    {
      requestId: completion.requestId,
      requesterId: completion.requesterId,
      requesterLabel: completion.requesterLabel ?? null,
      roleIds: uniqueRoleIds(completion.roleIds).join(","),
      requestDescription: normalizeDescription(completion.requestDescription),
      completedByUserId: completion.completedByUserId,
      completionDescription: normalizedCompletionDescription,
    },
  );
};
