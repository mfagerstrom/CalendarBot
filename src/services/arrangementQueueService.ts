import {
  ActionRowBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { MessageFlags } from "discord.js";
import type { Client } from "discordx";
import { query } from "../lib/db/oracle.js";

interface IArrangementQueueOccurrence {
  id: number;
  summary: string;
  occurrenceStart: Date;
  isAllDay: boolean;
  completedAt: Date | null;
  arrangementsNotes: string | null;
  roleIds: string[];
}

const ARRANGEMENT_PING_WINDOW_DAYS = 3;
const MAX_QUEUE_OPTIONS = 25;

export const ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID = "arrangements-queue-complete";
export const ARRANGEMENT_QUEUE_NOTES_SELECT_ID = "arrangements-queue-notes";
export const ARRANGEMENT_QUEUE_COMPLETE_MODAL_REGEX = /^arrangements-queue-complete:\d+$/;
export const ARRANGEMENT_QUEUE_NOTES_MODAL_REGEX = /^arrangements-queue-notes:\d+$/;

const parseRoleIds = (value: string): string[] => {
  if (!value) return [];
  const ids = value
    .split(/[ ,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const match = part.match(/\d{6,}/g);
      return match ? match : [];
    });

  return Array.from(new Set(ids));
};

const formatRoleMentions = (roleIds: string[]): string => {
  if (!roleIds.length) return "";
  return roleIds.map((id) => `<@&${id}>`).join(" ");
};

const toUnixTimestamp = (value: Date): number => Math.floor(value.getTime() / 1000);

const formatWhen = (occurrence: IArrangementQueueOccurrence): string => {
  if (occurrence.isAllDay) {
    const utcMidnight = new Date(Date.UTC(
      occurrence.occurrenceStart.getUTCFullYear(),
      occurrence.occurrenceStart.getUTCMonth(),
      occurrence.occurrenceStart.getUTCDate(),
    ));
    const unix = toUnixTimestamp(utcMidnight);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
  }

  const unix = toUnixTimestamp(occurrence.occurrenceStart);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
};

const buildArrangementQueueComponents = (
  occurrences: IArrangementQueueOccurrence[],
): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>> => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Upcoming Events Requiring Arrangements"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Read-only queue. Shows all arrangement reminders for events that have not passed yet. Pings start ${ARRANGEMENT_PING_WINDOW_DAYS} days before an event when arrangements are still pending.`,
    ),
  );

  const pending = occurrences.filter((occurrence) => !occurrence.completedAt);
  const completed = occurrences.filter((occurrence) => occurrence.completedAt);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  const formatLine = (
    occurrence: IArrangementQueueOccurrence,
    includeRoles: boolean,
    includeNotes: boolean,
  ): string => {
    const summary = occurrence.summary || "(No title)";
    const roleMentions = includeRoles ? formatRoleMentions(occurrence.roleIds) : "";
    const notes = includeNotes && occurrence.arrangementsNotes
      ? ` | Notes: ${occurrence.arrangementsNotes}`
      : "";
    const rolesText = roleMentions ? ` | ${roleMentions}` : "";
    return `- **${summary}** | ${formatWhen(occurrence)}${rolesText}${notes}`;
  };

  const pendingLines = pending.map((occurrence) => formatLine(occurrence, true, true));
  const completedLines = completed.map((occurrence) => formatLine(occurrence, false, true));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Arrangements Needed"),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      pendingLines.length ? pendingLines.join("\n") : "No upcoming events need arrangements.",
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Arrangements Set"),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      completedLines.length ? completedLines.join("\n") : "No upcoming events have arrangements set.",
    ),
  );
  const components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>> = [
    container,
  ];

  if (pending.length > 0) {
    const options = pending.slice(0, MAX_QUEUE_OPTIONS).map((occurrence) => {
      const summary = occurrence.summary || "(No title)";
      const label = summary.length > 100 ? summary.slice(0, 100) : summary;
      return {
        label,
        value: String(occurrence.id),
      };
    });

    if (options.length > 0) {
      const completeSelect = new StringSelectMenuBuilder()
        .setCustomId(ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID)
        .setPlaceholder("Mark Arrangements Set...")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      const notesSelect = new StringSelectMenuBuilder()
        .setCustomId(ARRANGEMENT_QUEUE_NOTES_SELECT_ID)
        .setPlaceholder("Add/Edit Notes")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(completeSelect));
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(notesSelect));
    }
  }

  return components;
};

const listUpcomingArrangementOccurrences = async (): Promise<IArrangementQueueOccurrence[]> => {
  const rows = await query<any>(
    `
      SELECT
        occ.id,
        occ.summary,
        occ.occurrence_start,
        occ.completed_at,
        occ.arrangements_notes,
        rules.ping_roles,
        evt.is_all_day
      FROM CALENDAR_ReminderOccurrences occ
      INNER JOIN CALENDAR_ReminderRules rules
        ON rules.id = occ.rule_id
      LEFT JOIN CALENDAR_EVENTS evt
        ON evt.CALENDAR_ID = occ.CALENDAR_ID
       AND evt.EVENT_ID = occ.EVENT_ID
      WHERE occ.arrangements_required = 1
        AND TRUNC(CURRENT_TIMESTAMP) >= TRUNC(occ.occurrence_start - rules.reminder_days)
        AND TRUNC(CURRENT_TIMESTAMP) <= TRUNC(occ.occurrence_start)
      ORDER BY occ.occurrence_start ASC
    `,
  );

  return rows.map((row) => ({
    id: Number(row.ID),
    summary: String(row.SUMMARY ?? ""),
    occurrenceStart: new Date(row.OCCURRENCE_START),
    isAllDay: Number(row.IS_ALL_DAY ?? 0) === 1,
    completedAt: row.COMPLETED_AT ? new Date(row.COMPLETED_AT) : null,
    arrangementsNotes: row.ARRANGEMENTS_NOTES ? String(row.ARRANGEMENTS_NOTES) : null,
    roleIds: parseRoleIds(String(row.PING_ROLES ?? "")),
  }));
};

const upsertArrangementQueueMessage = async (
  channelId: string,
  messageId: string,
): Promise<void> => {
  await query(
    `
      MERGE INTO CALENDAR_ArrangementQueueMessages target
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

export const ensureArrangementQueueMessage = async (
  client: Client,
  channelId: string,
): Promise<void> => {
  const rows = await query<any>(
    `SELECT MESSAGE_ID FROM CALENDAR_ArrangementQueueMessages WHERE CHANNEL_ID = :channelId`,
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

  const occurrences = await listUpcomingArrangementOccurrences();
  const components = buildArrangementQueueComponents(occurrences);
  const allowedMentions = { parse: [] as string[] };

  if (needsCreation) {
    const message = await (channel as any).send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions,
    });
    await upsertArrangementQueueMessage(channelId, message.id);
    return;
  }

  const message = await (channel as any).messages.fetch(existingMessageId);
  await message.edit({
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions,
  });
};
