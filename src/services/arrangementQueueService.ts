import {
  ContainerBuilder,
  SeparatorBuilder,
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
}

const REMINDER_TIMEZONE = "America/New_York";
const ARRANGEMENT_PING_WINDOW_DAYS = 3;

const formatWhen = (occurrence: IArrangementQueueOccurrence): string => {
  const dateText = occurrence.isAllDay
    ? occurrence.occurrenceStart.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : occurrence.occurrenceStart.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: REMINDER_TIMEZONE,
      });

  if (occurrence.isAllDay) {
    return `${dateText} (all day)`;
  }

  const timeText = occurrence.occurrenceStart.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: REMINDER_TIMEZONE,
  });
  return `${dateText} at ${timeText}`;
};

const buildArrangementQueueComponents = (
  occurrences: IArrangementQueueOccurrence[],
): ContainerBuilder[] => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Upcoming Arrangements"),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Read-only queue. Pings start ${ARRANGEMENT_PING_WINDOW_DAYS} days before an event when arrangements are still pending.`,
    ),
  );

  if (!occurrences.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No upcoming events currently need arrangements."),
    );
    return [container];
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  const lines = occurrences.map((occurrence) => {
    const summary = occurrence.summary || "(No title)";
    return `- ${summary} | ${formatWhen(occurrence)} | ID: ${occurrence.id}`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
  return [container];
};

const listUpcomingArrangementOccurrences = async (): Promise<IArrangementQueueOccurrence[]> => {
  const rows = await query<any>(
    `
      SELECT
        occ.id,
        occ.summary,
        occ.occurrence_start,
        evt.is_all_day
      FROM CALENDAR_ReminderOccurrences occ
      LEFT JOIN CALENDAR_EVENTS evt
        ON evt.CALENDAR_ID = occ.CALENDAR_ID
       AND evt.EVENT_ID = occ.EVENT_ID
      WHERE occ.arrangements_required = 1
        AND occ.completed_at IS NULL
        AND occ.reminder_at <= CURRENT_TIMESTAMP
        AND occ.occurrence_start >= CURRENT_TIMESTAMP
      ORDER BY occ.occurrence_start ASC
    `,
  );

  return rows.map((row) => ({
    id: Number(row.ID),
    summary: String(row.SUMMARY ?? ""),
    occurrenceStart: new Date(row.OCCURRENCE_START),
    isAllDay: Number(row.IS_ALL_DAY ?? 0) === 1,
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
