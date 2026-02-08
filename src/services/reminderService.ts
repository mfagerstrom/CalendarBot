import { query } from "../lib/db/oracle.js";
import { CHANNELS } from "../config/channels.js";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { ActionRowBuilder, ButtonBuilder } from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord.js";
import type { Client } from "discordx";
import { addDaysToYmd, getYmdInTimezone, iterateYmdRangeInclusive } from "./eventDateUtils.js";

export interface IReminderRule {
  id: number;
  keyword: string;
  reminderDays: number;
  pingRoles: string[];
  arrangementsRequired: boolean;
}

export interface IReminderOccurrence {
  id: number;
  ruleId: number;
  calendarId: string;
  eventId: string;
  occurrenceStart: Date;
  occurrenceEnd?: Date | null;
  summary: string;
  reminderAt: Date;
  isAllDay?: boolean;
  arrangementsNotes?: string | null;
  arrangementsRequired: boolean;
  completedAt?: Date | null;
  lastPromptAt?: Date | null;
  snoozedUntil?: Date | null;
  promptMessageId?: string | null;
}

const REMINDER_ACK_PREFIX = "reminder-ack";
export const REMINDER_ACK_REGEX = /^reminder-ack:\d+$/;
const REMINDER_NOTES_PREFIX = "reminder-notes";
export const REMINDER_NOTES_REGEX = /^reminder-notes:\d+$/;
export const REMINDER_SNOOZE_REGEX = /^reminder-snooze:\d+$/;
export const REMINDER_ARRANGEMENTS_REGEX = /^reminder-arrangements:\d+$/;

const REMINDER_LOOKAHEAD_DAYS = 90;
const REMINDER_TIMEZONE = "America/New_York";
const ARRANGEMENT_PING_WINDOW_DAYS = 3;

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

const buildRoleMentions = (roleIds: string[]): string => {
  if (!roleIds.length) return "";
  return roleIds.map((id) => `<@&${id}>`).join(" ");
};

const normalizeKeyword = (value: string): string => {
  return value.trim().toLowerCase();
};

const normalizeForMatch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
};

const normalizeArrangementNotes = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const formatSummaryForReminder = (summary: string): string => {
  return summary;
};

const toUnixTimestamp = (value: Date): number => Math.floor(value.getTime() / 1000);

const makeDateInTimeZone = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date => {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const tzDate = new Date(utcDate.toLocaleString("en-US", { timeZone }));
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  return new Date(utcDate.getTime() + offsetMs);
};

const formatDiscordDateWithRelative = (occurrence: IReminderOccurrence): string => {
  if (occurrence.isAllDay) {
    const ymd = getYmdInTimezone(occurrence.occurrenceStart, "UTC");
    const [yearStr, monthStr, dayStr] = ymd.split("-");
    const localMidnight = makeDateInTimeZone(
      Number(yearStr),
      Number(monthStr),
      Number(dayStr),
      0,
      0,
      REMINDER_TIMEZONE,
    );
    const unix = toUnixTimestamp(localMidnight);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
  }

  const unix = toUnixTimestamp(occurrence.occurrenceStart);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
};

const getAllDayUtcDate = (value: Date): Date => {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
};

const getTimePartsInTimeZone = (
  value: Date,
  timeZone: string,
): { hour: number; minute: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { hour, minute };
};

const buildOccurrenceStartForDay = (
  dayYmd: string,
  timeZone: string,
  timeParts?: { hour: number; minute: number },
): Date => {
  const [yearStr, monthStr, dayStr] = dayYmd.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = timeParts?.hour ?? 0;
  const minute = timeParts?.minute ?? 0;
  return makeDateInTimeZone(year, month, day, hour, minute, timeZone);
};

const getUtcDayRange = (dayYmd: string): { start: Date; end: Date } => {
  const start = new Date(`${dayYmd}T00:00:00Z`);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const computeReminderAt = (
  occurrenceStart: Date,
  isAllDay: boolean,
  reminderDays: number,
): Date => {
  const reminderAt = new Date(occurrenceStart.getTime());
  reminderAt.setUTCDate(reminderAt.getUTCDate() - reminderDays);
  if (!isAllDay) {
    return reminderAt;
  }

  const allDayUtc = getAllDayUtcDate(occurrenceStart);
  allDayUtc.setUTCDate(allDayUtc.getUTCDate() - reminderDays);
  const reminderDate = makeDateInTimeZone(
    allDayUtc.getUTCFullYear(),
    allDayUtc.getUTCMonth() + 1,
    allDayUtc.getUTCDate(),
    12,
    0,
    REMINDER_TIMEZONE,
  );
  return reminderDate;
};

export const addReminderRule = async (
  createdBy: string,
  keyword: string,
  reminderDays: number,
  pingRoleIds: string[],
  arrangementsRequired: boolean,
): Promise<void> => {
  const normalized = normalizeKeyword(keyword);
  const roles = Array.from(new Set(pingRoleIds.map((id) => id.trim()).filter(Boolean)));

  await query(
    `
      INSERT INTO CALENDAR_ReminderRules (
        keyword,
        reminder_days,
        ping_roles,
        arrangements_required,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        :keyword,
        :reminderDays,
        :pingRoles,
        :arrangementsRequired,
        :createdBy,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    {
      keyword: normalized,
      reminderDays,
      pingRoles: roles.join(","),
      arrangementsRequired: arrangementsRequired ? 1 : 0,
      createdBy,
    },
  );
};

export const listReminderRules = async (): Promise<IReminderRule[]> => {
  const rows = await query<any>(
    `
      SELECT
        id,
        keyword,
        reminder_days,
        ping_roles,
        arrangements_required
      FROM CALENDAR_ReminderRules
      ORDER BY id ASC
    `,
  );

  return rows.map((row) => ({
    id: Number(row.ID),
    keyword: String(row.KEYWORD ?? ""),
    reminderDays: Number(row.REMINDER_DAYS ?? 0),
    pingRoles: parseRoleIds(String(row.PING_ROLES ?? "")),
    arrangementsRequired: Number(row.ARRANGEMENTS_REQUIRED ?? 0) === 1,
  }));
};

export const removeReminderRule = async (id: number): Promise<void> => {
  await query(
    "DELETE FROM CALENDAR_ReminderRules WHERE id = :id",
    { id },
  );
  await query(
    "DELETE FROM CALENDAR_ReminderOccurrences WHERE rule_id = :id",
    { id },
  );
};

export const getReminderRules = async (): Promise<IReminderRule[]> => {
  return listReminderRules();
};

const deleteOccurrencesForMissingRules = async (): Promise<void> => {
  await query(
    `
      DELETE FROM CALENDAR_ReminderOccurrences
      WHERE rule_id NOT IN (SELECT id FROM CALENDAR_ReminderRules)
    `,
  );
};

const getMatchingRule = (summary: string, rules: IReminderRule[]): IReminderRule | null => {
  const normalizedSummary = normalizeForMatch(summary);
  const sortedRules = [...rules].sort((a, b) => b.keyword.length - a.keyword.length);
  return (
    sortedRules.find((rule) => normalizedSummary.includes(normalizeForMatch(rule.keyword))) ?? null
  );
};

export const applyReminderFlags = <T extends { summary?: string | null }>(
  events: T[],
  rules: IReminderRule[],
): (T & { reminder?: boolean })[] => {
  return events.map((event) => {
    const summary = event.summary ?? "";
    if (!summary) return event as T & { reminder?: boolean };
    const match = getMatchingRule(summary, rules);
    if (!match) return event as T & { reminder?: boolean };
    return { ...event, reminder: true };
  });
};

const insertOccurrenceIfMissing = async (
  rule: IReminderRule,
  calendarId: string,
  eventId: string,
  summary: string,
  occurrenceStart: Date,
  occurrenceEnd: Date | null,
  reminderAt: Date,
  isAllDay: boolean,
): Promise<void> => {
  const rows = await query<any>(
    `
      SELECT
        id,
        reminder_at,
        completed_at
      FROM CALENDAR_ReminderOccurrences
      WHERE rule_id = :ruleId
        AND calendar_id = :calendarId
        AND event_id = :eventId
        AND occurrence_start = :occurrenceStart
    `,
    {
      ruleId: rule.id,
      calendarId,
      eventId,
      occurrenceStart,
    },
  );

  if (rows.length > 0) {
    if (!isAllDay) return;
    const row = rows[0];
    if (row.COMPLETED_AT) return;
    const existingReminderAt = row.REMINDER_AT ? new Date(row.REMINDER_AT) : null;
    if (!existingReminderAt || existingReminderAt.getTime() !== reminderAt.getTime()) {
      await query(
        `
          UPDATE CALENDAR_ReminderOccurrences
          SET reminder_at = :reminderAt,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = :id
        `,
        { id: Number(row.ID), reminderAt },
      );
    }
    return;
  }

  await query(
    `
      INSERT INTO CALENDAR_ReminderOccurrences (
        rule_id,
        calendar_id,
        event_id,
        occurrence_start,
        occurrence_end,
        summary,
        reminder_at,
        arrangements_required,
        created_at,
        updated_at
      ) VALUES (
        :ruleId,
        :calendarId,
        :eventId,
        :occurrenceStart,
        :occurrenceEnd,
        :summary,
        :reminderAt,
        :arrangementsRequired,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    {
      ruleId: rule.id,
      calendarId,
      eventId,
      occurrenceStart,
      occurrenceEnd,
      summary,
      reminderAt,
      arrangementsRequired: rule.arrangementsRequired ? 1 : 0,
    },
  );
};

const fetchUpcomingEvents = async (lookAheadDays: number): Promise<any[]> => {
  return query<any>(
    `
      SELECT
        CALENDAR_ID,
        EVENT_ID,
        SUMMARY,
        START_TIME,
        END_TIME,
        IS_ALL_DAY
      FROM CALENDAR_EVENTS
      WHERE START_TIME >= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
        AND START_TIME <= (CURRENT_TIMESTAMP + INTERVAL '${lookAheadDays}' DAY)
        AND STATUS != 'cancelled'
    `,
  );
};

const hydrateOccurrences = async (rules: IReminderRule[]): Promise<void> => {
  if (rules.length === 0) return;

  const lookAheadDays = REMINDER_LOOKAHEAD_DAYS;
  const events = await fetchUpcomingEvents(lookAheadDays);

  for (const event of events) {
    const summary = String(event.SUMMARY ?? "");
    if (!summary) continue;
    const match = getMatchingRule(summary, rules);
    if (!match) continue;

    const occurrenceStart = new Date(event.START_TIME);
    const occurrenceEnd = event.END_TIME ? new Date(event.END_TIME) : null;
    const isAllDay = Number(event.IS_ALL_DAY ?? 0) === 1;

    const eventTimezone = isAllDay ? "UTC" : REMINDER_TIMEZONE;
    const startYmd = getYmdInTimezone(occurrenceStart, eventTimezone);
    const endYmd = occurrenceEnd
      ? getYmdInTimezone(occurrenceEnd, eventTimezone)
      : startYmd;
    const endInclusiveYmd = isAllDay ? addDaysToYmd(endYmd, -1) : endYmd;

    const timeParts = isAllDay ? undefined : getTimePartsInTimeZone(
      occurrenceStart,
      REMINDER_TIMEZONE,
    );

    for (const dayYmd of iterateYmdRangeInclusive(startYmd, endInclusiveYmd)) {
      const occurrenceStartForDay = buildOccurrenceStartForDay(
        dayYmd,
        isAllDay ? "UTC" : REMINDER_TIMEZONE,
        timeParts,
      );
      if (isAllDay) {
        const dayRange = getUtcDayRange(dayYmd);
        await query(
          `
            DELETE FROM CALENDAR_ReminderOccurrences
            WHERE calendar_id = :calendarId
              AND event_id = :eventId
              AND rule_id = :ruleId
              AND completed_at IS NULL
              AND occurrence_start >= :dayStart
              AND occurrence_start < :dayEnd
              AND occurrence_start != :occurrenceStart
          `,
          {
            calendarId: String(event.CALENDAR_ID),
            eventId: String(event.EVENT_ID),
            ruleId: match.id,
            dayStart: dayRange.start,
            dayEnd: dayRange.end,
            occurrenceStart: occurrenceStartForDay,
          },
        );
      }
      const reminderAt = computeReminderAt(
        occurrenceStartForDay,
        isAllDay,
        match.reminderDays,
      );

      await query(
        `
          DELETE FROM CALENDAR_ReminderOccurrences
          WHERE calendar_id = :calendarId
            AND event_id = :eventId
            AND occurrence_start = :occurrenceStart
            AND rule_id != :ruleId
        `,
        {
          calendarId: String(event.CALENDAR_ID),
          eventId: String(event.EVENT_ID),
          occurrenceStart: occurrenceStartForDay,
          ruleId: match.id,
        },
      );

      await insertOccurrenceIfMissing(
        match,
        String(event.CALENDAR_ID),
        String(event.EVENT_ID),
        summary,
        occurrenceStartForDay,
        occurrenceEnd,
        reminderAt,
        isAllDay,
      );
    }
  }
};

const fetchDueOccurrences = async (): Promise<IReminderOccurrence[]> => {
  const rows = await query<any>(
    `
      SELECT
        occ.id,
        occ.rule_id,
        occ.calendar_id,
        occ.event_id,
        occ.occurrence_start,
        occ.occurrence_end,
        occ.summary,
        occ.reminder_at,
        occ.arrangements_notes,
        occ.arrangements_required,
        occ.completed_at,
        occ.last_prompt_at,
        occ.snoozed_until,
        occ.prompt_message_id,
        evt.is_all_day
      FROM CALENDAR_ReminderOccurrences occ
      INNER JOIN CALENDAR_ReminderRules rules
        ON rules.id = occ.rule_id
      LEFT JOIN CALENDAR_EVENTS evt
        ON evt.CALENDAR_ID = occ.CALENDAR_ID
       AND evt.EVENT_ID = occ.EVENT_ID
      WHERE occ.completed_at IS NULL
        AND occ.reminder_at <= CURRENT_TIMESTAMP
        AND (occ.snoozed_until IS NULL OR occ.snoozed_until <= CURRENT_TIMESTAMP)
        AND (
          (evt.is_all_day = 1 AND TRUNC(occ.occurrence_start) >= TRUNC(CURRENT_TIMESTAMP))
          OR (evt.is_all_day = 0 AND occ.occurrence_start >= CURRENT_TIMESTAMP)
        )
        AND (
          occ.arrangements_required = 0
          OR occ.occurrence_start <= (CURRENT_TIMESTAMP + INTERVAL '${ARRANGEMENT_PING_WINDOW_DAYS}' DAY)
        )
        AND (
          occ.last_prompt_at IS NULL
          OR occ.last_prompt_at <= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
        )
    `,
  );

  return rows.map((row) => ({
    id: Number(row.ID),
    ruleId: Number(row.RULE_ID),
    calendarId: String(row.CALENDAR_ID ?? ""),
    eventId: String(row.EVENT_ID ?? ""),
    occurrenceStart: new Date(row.OCCURRENCE_START),
    occurrenceEnd: row.OCCURRENCE_END ? new Date(row.OCCURRENCE_END) : null,
    summary: String(row.SUMMARY ?? ""),
    reminderAt: new Date(row.REMINDER_AT),
    isAllDay: Number(row.IS_ALL_DAY ?? 0) === 1,
    arrangementsNotes: row.ARRANGEMENTS_NOTES ? String(row.ARRANGEMENTS_NOTES) : null,
    arrangementsRequired: Number(row.ARRANGEMENTS_REQUIRED ?? 0) === 1,
    completedAt: row.COMPLETED_AT ? new Date(row.COMPLETED_AT) : null,
    lastPromptAt: row.LAST_PROMPT_AT ? new Date(row.LAST_PROMPT_AT) : null,
    snoozedUntil: row.SNOOZED_UNTIL ? new Date(row.SNOOZED_UNTIL) : null,
    promptMessageId: row.PROMPT_MESSAGE_ID ? String(row.PROMPT_MESSAGE_ID) : null,
  }));
};

const fetchActivePromptOccurrences = async (): Promise<IReminderOccurrence[]> => {
  const rows = await query<any>(
    `
      SELECT
        occ.id,
        occ.rule_id,
        occ.calendar_id,
        occ.event_id,
        occ.occurrence_start,
        occ.occurrence_end,
        occ.summary,
        occ.reminder_at,
        occ.arrangements_notes,
        occ.arrangements_required,
        occ.completed_at,
        occ.last_prompt_at,
        occ.snoozed_until,
        occ.prompt_message_id,
        evt.is_all_day
      FROM CALENDAR_ReminderOccurrences occ
      LEFT JOIN CALENDAR_EVENTS evt
        ON evt.CALENDAR_ID = occ.CALENDAR_ID
       AND evt.EVENT_ID = occ.EVENT_ID
      WHERE occ.prompt_message_id IS NOT NULL
        AND (
          (evt.is_all_day = 1 AND TRUNC(occ.occurrence_start) >= TRUNC(CURRENT_TIMESTAMP))
          OR (evt.is_all_day = 0 AND occ.occurrence_start >= CURRENT_TIMESTAMP)
        )
    `,
  );

  return rows.map((row) => ({
    id: Number(row.ID),
    ruleId: Number(row.RULE_ID),
    calendarId: String(row.CALENDAR_ID ?? ""),
    eventId: String(row.EVENT_ID ?? ""),
    occurrenceStart: new Date(row.OCCURRENCE_START),
    occurrenceEnd: row.OCCURRENCE_END ? new Date(row.OCCURRENCE_END) : null,
    summary: String(row.SUMMARY ?? ""),
    reminderAt: new Date(row.REMINDER_AT),
    isAllDay: Number(row.IS_ALL_DAY ?? 0) === 1,
    arrangementsNotes: row.ARRANGEMENTS_NOTES ? String(row.ARRANGEMENTS_NOTES) : null,
    arrangementsRequired: Number(row.ARRANGEMENTS_REQUIRED ?? 0) === 1,
    completedAt: row.COMPLETED_AT ? new Date(row.COMPLETED_AT) : null,
    lastPromptAt: row.LAST_PROMPT_AT ? new Date(row.LAST_PROMPT_AT) : null,
    snoozedUntil: row.SNOOZED_UNTIL ? new Date(row.SNOOZED_UNTIL) : null,
    promptMessageId: row.PROMPT_MESSAGE_ID ? String(row.PROMPT_MESSAGE_ID) : null,
  }));
};

const markPromptSent = async (
  occurrenceId: number,
  messageId: string,
  arrangementsRequired: boolean,
): Promise<void> => {
  const snoozeSql = arrangementsRequired
    ? "snoozed_until = (CURRENT_TIMESTAMP + INTERVAL '1' DAY),"
    : "snoozed_until = NULL,";
  await query(
    `
      UPDATE CALENDAR_ReminderOccurrences
      SET last_prompt_at = CURRENT_TIMESTAMP,
          ${snoozeSql}
          prompt_message_id = :messageId,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `,
    { id: occurrenceId, messageId },
  );
};

const markCompleted = async (occurrenceId: number): Promise<void> => {
  await query(
    `
      UPDATE CALENDAR_ReminderOccurrences
      SET completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `,
    { id: occurrenceId },
  );
};

export const snoozeOccurrence = async (occurrenceId: number): Promise<void> => {
  await query(
    `
      UPDATE CALENDAR_ReminderOccurrences
      SET snoozed_until = (CURRENT_TIMESTAMP + INTERVAL '1' DAY),
          last_prompt_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `,
    { id: occurrenceId },
  );
};

export const completeOccurrence = async (occurrenceId: number): Promise<void> => {
  await markCompleted(occurrenceId);
};

export const completeOccurrenceWithArrangements = async (
  occurrenceId: number,
  arrangementsNotes: string,
): Promise<void> => {
  await query(
    `
      UPDATE CALENDAR_ReminderOccurrences
      SET arrangements_notes = :arrangementsNotes,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `,
    { id: occurrenceId, arrangementsNotes },
  );
};

export const updateOccurrenceArrangementsNotes = async (
  occurrenceId: number,
  arrangementsNotes: string,
): Promise<void> => {
  const normalizedNotes = normalizeArrangementNotes(arrangementsNotes);
  await query(
    `
      UPDATE CALENDAR_ReminderOccurrences
      SET arrangements_notes = :arrangementsNotes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
    `,
    {
      id: occurrenceId,
      arrangementsNotes: normalizedNotes || null,
    },
  );
};

export const getOccurrenceById = async (
  occurrenceId: number,
): Promise<IReminderOccurrence | null> => {
  const rows = await query<any>(
    `
      SELECT
        occ.id,
        occ.rule_id,
        occ.calendar_id,
        occ.event_id,
        occ.occurrence_start,
        occ.occurrence_end,
        occ.summary,
        occ.reminder_at,
        occ.arrangements_notes,
        occ.arrangements_required,
        occ.completed_at,
        occ.last_prompt_at,
        occ.snoozed_until,
        occ.prompt_message_id,
        evt.is_all_day
      FROM CALENDAR_ReminderOccurrences occ
      LEFT JOIN CALENDAR_EVENTS evt
        ON evt.CALENDAR_ID = occ.CALENDAR_ID
       AND evt.EVENT_ID = occ.EVENT_ID
      WHERE id = :id
    `,
    { id: occurrenceId },
  );

  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.ID),
    ruleId: Number(row.RULE_ID),
    calendarId: String(row.CALENDAR_ID ?? ""),
    eventId: String(row.EVENT_ID ?? ""),
    occurrenceStart: new Date(row.OCCURRENCE_START),
    occurrenceEnd: row.OCCURRENCE_END ? new Date(row.OCCURRENCE_END) : null,
    summary: String(row.SUMMARY ?? ""),
    reminderAt: new Date(row.REMINDER_AT),
    isAllDay: Number(row.IS_ALL_DAY ?? 0) === 1,
    arrangementsNotes: row.ARRANGEMENTS_NOTES ? String(row.ARRANGEMENTS_NOTES) : null,
    arrangementsRequired: Number(row.ARRANGEMENTS_REQUIRED ?? 0) === 1,
    completedAt: row.COMPLETED_AT ? new Date(row.COMPLETED_AT) : null,
    lastPromptAt: row.LAST_PROMPT_AT ? new Date(row.LAST_PROMPT_AT) : null,
    snoozedUntil: row.SNOOZED_UNTIL ? new Date(row.SNOOZED_UNTIL) : null,
    promptMessageId: row.PROMPT_MESSAGE_ID ? String(row.PROMPT_MESSAGE_ID) : null,
  };
};

export const buildPromptComponents = (
  occurrence: IReminderOccurrence,
  rule: IReminderRule | undefined,
): { components: ContainerBuilder[] } => {
  const title = "## Reminder";
  const whenLine = `**When:** ${formatDiscordDateWithRelative(occurrence)}`;

  const summaryLine = formatSummaryForReminder(occurrence.summary || "(No title)");

  const noteText = normalizeArrangementNotes(occurrence.arrangementsNotes);
  const lines = [`**Event:** ${summaryLine}`, whenLine];
  const roleMentions = rule ? buildRoleMentions(rule.pingRoles) : "";
  if (roleMentions) {
    lines.push(`**Affects:** ${roleMentions}`);
  }
  if (noteText) {
    lines.push(`**Note:** ${noteText}`);
  }

  const detailLines: string[] = [];

  if (occurrence.arrangementsRequired) {
    detailLines.push("-# **Arrangements needed:** Please confirm when done.");
  }

  if (detailLines.length > 0) {
    lines.push("", ...detailLines);
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(title),
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  if (occurrence.arrangementsRequired) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${REMINDER_ACK_PREFIX}:${occurrence.id}`)
        .setLabel("Arrangements Made")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${REMINDER_NOTES_PREFIX}:${occurrence.id}`)
        .setLabel("Add/Edit Notes")
        .setStyle(ButtonStyle.Secondary),
    );

    container.addActionRowComponents(row);
  }

  return { components: [container] };
};

export const buildConfirmedComponents = (
  occurrence: IReminderOccurrence,
  rule: IReminderRule | undefined,
): { components: ContainerBuilder[] } => {
  const title = "## Reminder";
  const whenLine = `**When:** ${formatDiscordDateWithRelative(occurrence)}`;

  const summaryLine = formatSummaryForReminder(occurrence.summary || "(No title)");

  const noteText = normalizeArrangementNotes(occurrence.arrangementsNotes);
  const lines = [`**Event:** ${summaryLine}`, whenLine];
  const roleMentions = rule ? buildRoleMentions(rule.pingRoles) : "";
  if (roleMentions) {
    lines.push(`**Affects:** ${roleMentions}`);
  }
  if (noteText) {
    lines.push(`**Note:** ${noteText}`);
  }

  const detailLines: string[] = [];

  if (occurrence.arrangementsRequired && !noteText) {
    detailLines.push("-# **Arrangements confirmed.**");
  }

  if (detailLines.length > 0) {
    lines.push("", ...detailLines);
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(title),
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  return { components: [container] };
};

const buildAcknowledgedComponents = (message: string): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(message),
  );
  return { components: [container] };
};

export const processReminders = async (client: Client): Promise<void> => {
  const rules = await getReminderRules();
  await deleteOccurrencesForMissingRules();
  if (!rules.length) return;

  await hydrateOccurrences(rules);

  const dueOccurrences = await fetchDueOccurrences();
  if (!dueOccurrences.length) return;

  const channel = await client.channels.fetch(CHANNELS.CALENDAR_REMINDERS);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  for (const occurrence of dueOccurrences) {
    const rule = rules.find((r) => r.id === occurrence.ruleId);
    const payload = buildPromptComponents(occurrence, rule);
    const sent = await (channel as any).send({
      ...payload,
      flags: MessageFlags.IsComponentsV2,
    });

    await markPromptSent(occurrence.id, sent.id, occurrence.arrangementsRequired);

    if (!occurrence.arrangementsRequired) {
      await markCompleted(occurrence.id);
    }
  }
};

export const refreshActiveReminderMessages = async (client: Client): Promise<void> => {
  const occurrences = await fetchActivePromptOccurrences();
  if (!occurrences.length) return;

  const channel = await client.channels.fetch(CHANNELS.CALENDAR_REMINDERS);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const rules = await getReminderRules();

  for (const occurrence of occurrences) {
    if (!occurrence.promptMessageId) continue;
    const rule = rules.find((item) => item.id === occurrence.ruleId);
    const payload = occurrence.completedAt
      ? buildConfirmedComponents(occurrence, rule)
      : buildPromptComponents(occurrence, rule);
    try {
      const message = await (channel as any).messages.fetch(occurrence.promptMessageId);
      await message.edit({
        components: payload.components,
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      console.error("Failed to refresh reminder message:", err);
    }
  }
};

export const buildAckResponse = (text: string): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text),
  );
  return { components: [container] };
};

export const buildSnoozedResponse = (): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("Snoozed for 1 day. I will remind you again."),
  );
  return { components: [container] };
};

export const parseReminderId = (
  customId: string,
  prefix: string,
): number | null => {
  const parts = customId.split(":");
  if (parts.length !== 2 || parts[0] !== prefix) return null;
  const id = Number(parts[1]);
  if (!Number.isFinite(id)) return null;
  return id;
};

export const formatRulesList = (rules: IReminderRule[]): string => {
  if (!rules.length) return "No reminder rules found.";

  return rules
    .map((rule) => {
      const roleMentions = buildRoleMentions(rule.pingRoles);
      const rolesText = roleMentions ? `Roles: ${roleMentions}` : "Roles: none";
      const arrangementsText = rule.arrangementsRequired ? "Arrangements: yes" : "Arrangements: no";
      return `\`ID: ${rule.id}\` ${rule.keyword} (Remind: ${rule.reminderDays}d, ${rolesText}, ${arrangementsText})`;
    })
    .join("\n");
};

export const buildRulesListComponents = (rules: IReminderRule[]): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# Reminder Rules"),
    new TextDisplayBuilder().setContent(formatRulesList(rules)),
  );
  return { components: [container] };
};

export const buildRuleAddedComponents = (keyword: string): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`Added reminder rule for "${keyword}".`),
  );
  return { components: [container] };
};

export const buildRuleRemovedComponents = (id: number): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`Removed reminder rule ID ${id}.`),
  );
  return { components: [container] };
};

export const buildRuleErrorComponents = (message: string): { components: ContainerBuilder[] } => {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
  return { components: [container] };
};

export const normalizeReminderKeyword = (value: string): string => {
  return normalizeKeyword(value);
};

export const buildReminderPromptUpdate = (
  text: string,
): { components: ContainerBuilder[] } => {
  return buildAcknowledgedComponents(text);
};
