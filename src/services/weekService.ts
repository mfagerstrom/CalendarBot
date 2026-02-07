import { 
    getPrimaryCalendarTimezone, 
    getUserSelectedCalendars, 
    getEventsForTimeRange 
} from "./googleCalendarService.js";
import { filterEvents } from "./ignoreService.js";
import { query } from "../lib/db/oracle.js";
import { ContainerBuilder } from "@discordjs/builders";
import { buildEventSectionsContainer, buildSimpleTextContainer } from "./eventUiService.js";
import {
    addDaysToYmd,
    getYmdInTimezone,
    iterateYmdRangeInclusive,
    toAllDayEventForYmd,
} from "./eventDateUtils.js";
import { MessageFlags } from "discord.js";
import { Client } from "discordx";

export const getWeekEventData = async (userId: string) => {
    // 1. Get Timezone
    const timezone = await getPrimaryCalendarTimezone(userId);

    const rangeLengthDays = 30;

    // 2. Calculate rolling 30 day window starting tomorrow in User TZ
    const todayYmd = getYmdInTimezone(new Date(), timezone);
    const startYmd = addDaysToYmd(todayYmd, 1);
    const endYmd = addDaysToYmd(startYmd, rangeLengthDays - 1);
    
    // Safer bet: Query a wide range and filter precisely in code using the timezone string.
    
    const queryMin = new Date();
    queryMin.setDate(queryMin.getDate() - 7);
    const queryMax = new Date();
    queryMax.setDate(queryMax.getDate() + rangeLengthDays + 7);

    // 3. Get Calendars
    const calendars = await getUserSelectedCalendars(userId);
    if (calendars.length === 0) {
        return { error: "No calendars selected." };
    }

    // 4. Fetch Events
    const allEvents: any[] = [];
    for (const cal of calendars) {
        try {
            const events = await getEventsForTimeRange(userId, cal.calendarId, queryMin, queryMax);
            allEvents.push(...events);
        } catch (e) {
            console.error(`Failed to fetch for ${cal.calendarName}`, e);
        }
    }

    // 5. Filter and Group by Date
    // We want events where the START date falls between Local Monday 00:00 and Local Sunday 23:59
    
    // Format for comparison: YYYY-MM-DD in User TZ
    // const getLocalYMD = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
    
    // Generate the string keys for the range
    const weekMap = new Map<string, any[]>();
    const dateHeaders = new Map<string, string>(); // "2026-02-02" -> "Monday, Feb 2"

    const dateRange = iterateYmdRangeInclusive(startYmd, endYmd);
    for (const ymd of dateRange) {
        weekMap.set(ymd, []);
        const [yearStr, monthStr, dayStr] = ymd.split("-");
        const year = Number(yearStr);
        const monthIndex = Number(monthStr) - 1;
        const day = Number(dayStr);
        const headerDate = new Date(Date.UTC(year, monthIndex, day));
        const header = headerDate.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
        });
        dateHeaders.set(ymd, header);
    }

    // 5.5 Filter Ignored
    const filteredEvents = await filterEvents(userId, allEvents);

    // Group them, including multi-day events on each day they overlap.
    for (const event of filteredEvents) {
        if (!event.start) {
            continue;
        }

        if (event.start.date) {
            const startYmd = event.start.date;
            const endExclusiveYmd = event.end?.date || addDaysToYmd(startYmd, 1);
            const endInclusiveYmd = addDaysToYmd(endExclusiveYmd, -1);

            for (const dayYmd of iterateYmdRangeInclusive(startYmd, endInclusiveYmd)) {
                if (!weekMap.has(dayYmd)) {
                    continue;
                }
                weekMap.get(dayYmd)?.push(toAllDayEventForYmd(event, dayYmd));
            }
            continue;
        }

        if (!event.start.dateTime) {
            continue;
        }

        const startYmd = getYmdInTimezone(new Date(event.start.dateTime), timezone);
        const endYmd = event.end?.dateTime
            ? getYmdInTimezone(new Date(event.end.dateTime), timezone)
            : startYmd;

        if (startYmd === endYmd) {
            if (weekMap.has(startYmd)) {
                weekMap.get(startYmd)?.push(event);
            }
            continue;
        }

        for (const dayYmd of iterateYmdRangeInclusive(startYmd, endYmd)) {
            if (!weekMap.has(dayYmd)) {
                continue;
            }
            weekMap.get(dayYmd)?.push(toAllDayEventForYmd(event, dayYmd));
        }
    }

    // Sort events within each day
    for (const list of weekMap.values()) {
        list.sort((a, b) => {
            const tA = new Date(a.start.dateTime || a.start.date).getTime();
            const tB = new Date(b.start.dateTime || b.start.date).getTime();
            return tA - tB;
        });
    }

    return { 
        weekMap,
        dateHeaders,
        timezone,
        startLabel: dateHeaders.get(startYmd),
        endLabel: dateHeaders.get(endYmd)
    };
};

export const buildWeekResponse = (data: any) => {
    if (data.error) {
        return [[buildSimpleTextContainer(data.error)]];
    }

    const { weekMap, dateHeaders, timezone } = data;

    const messageComponents: ContainerBuilder[][] = [];

    for (const [key, events] of weekMap.entries()) {
        const headerTitle = dateHeaders.get(key) || "Day";
        const dayContainer = buildEventSectionsContainer({
            header: `# ${headerTitle}`,
            events,
            timezone,
        });
        messageComponents.push([dayContainer]);
    }

    return messageComponents;
};

const isMissingWeekMessagesTableError = (err: any): boolean => {
    const message = String(err?.message || "");
    return message.includes("ORA-00942");
};

const reconcileWeekMessagesForChannel = async (
    client: Client,
    channelId: string,
    existingMessageIds: string[],
    messageComponents: ContainerBuilder[][],
): Promise<string[]> => {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        return [];
    }

    const finalMessageIds: string[] = [];

    for (let i = 0; i < messageComponents.length; i++) {
        const existingMessageId = existingMessageIds[i];
        if (existingMessageId) {
            try {
                const existingMessage = await (channel as any).messages.fetch(existingMessageId);
                await existingMessage.edit({
                    components: messageComponents[i],
                    flags: MessageFlags.IsComponentsV2 as any,
                });
                finalMessageIds.push(existingMessageId);
                continue;
            } catch {
                // Message was likely deleted. Send a replacement below.
            }
        }

        const newMessage = await (channel as any).send({
            components: messageComponents[i],
            flags: MessageFlags.IsComponentsV2 as any,
        });
        finalMessageIds.push(newMessage.id);
    }

    for (let i = messageComponents.length; i < existingMessageIds.length; i++) {
        const staleId = existingMessageIds[i];
        try {
            const staleMessage = await (channel as any).messages.fetch(staleId);
            await staleMessage.delete();
        } catch {
            // Already gone.
        }
    }

    return finalMessageIds;
};

export const registerWeekMessages = async (
    userId: string,
    channelId: string,
    messageIds: string[],
): Promise<void> => {
    try {
        await query(
            `DELETE FROM CALENDAR_WeekMessages WHERE USER_ID = :userid AND CHANNEL_ID = :channelid`,
            { userid: userId, channelid: channelId },
        );

        for (let index = 0; index < messageIds.length; index++) {
            await query(
                `INSERT INTO CALENDAR_WeekMessages (
                    USER_ID,
                    CHANNEL_ID,
                    MESSAGE_ID,
                    SORT_ORDER,
                    CREATED_AT,
                    UPDATED_AT
                ) VALUES (
                    :userid,
                    :channelid,
                    :messageid,
                    :sortorder,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )`,
                {
                    userid: userId,
                    channelid: channelId,
                    messageid: messageIds[index],
                    sortorder: index,
                },
            );
        }
    } catch (err: any) {
        if (isMissingWeekMessagesTableError(err)) {
            console.warn(
                "Week message persistence is disabled until CALENDAR_WeekMessages exists.",
            );
            return;
        }
        throw err;
    }
};

export const forceUpdateAllWeekMessages = async (client: Client): Promise<void> => {
    try {
        const rows = await query<any>(`SELECT DISTINCT USER_ID FROM CALENDAR_WeekMessages`);
        for (const row of rows) {
            await updateUserWeekMessages(row.USER_ID, client);
        }
    } catch (err: any) {
        if (isMissingWeekMessagesTableError(err)) {
            console.warn(
                "Skipping week message updates because CALENDAR_WeekMessages is missing.",
            );
            return;
        }
        throw err;
    }
};

export const updateUserWeekMessages = async (
    userId: string,
    client: Client,
): Promise<void> => {
    type IWeekMessageRow = { CHANNEL_ID: string; MESSAGE_ID: string; SORT_ORDER: number };
    let rows: IWeekMessageRow[] = [];

    try {
        rows = await query<IWeekMessageRow>(
            `SELECT CHANNEL_ID, MESSAGE_ID, SORT_ORDER
             FROM CALENDAR_WeekMessages
             WHERE USER_ID = :userid
             ORDER BY CHANNEL_ID ASC, SORT_ORDER ASC`,
            { userid: userId },
        );
    } catch (err: any) {
        if (isMissingWeekMessagesTableError(err)) {
            return;
        }
        throw err;
    }

    if (rows.length === 0) {
        return;
    }

    const weekData = await getWeekEventData(userId);
    const messageComponents = buildWeekResponse(weekData);
    const rowsByChannel = new Map<string, IWeekMessageRow[]>();

    for (const row of rows) {
        const existing = rowsByChannel.get(row.CHANNEL_ID) || [];
        existing.push(row);
        rowsByChannel.set(row.CHANNEL_ID, existing);
    }

    for (const [channelId, channelRows] of rowsByChannel.entries()) {
        const existingMessageIds = channelRows.map((row) => row.MESSAGE_ID);
        const finalMessageIds = await reconcileWeekMessagesForChannel(
            client,
            channelId,
            existingMessageIds,
            messageComponents,
        );
        if (finalMessageIds.length === 0) {
            continue;
        }
        await registerWeekMessages(userId, channelId, finalMessageIds);
    }
};

export const ensureStaticWeekMessages = async (
    client: Client,
    userId: string,
    channelId: string,
): Promise<void> => {
    type IWeekMessageRow = { MESSAGE_ID: string; SORT_ORDER: number };
    let rows: IWeekMessageRow[] = [];
    try {
        rows = await query<IWeekMessageRow>(
            `SELECT MESSAGE_ID, SORT_ORDER
             FROM CALENDAR_WeekMessages
             WHERE USER_ID = :userid
             AND CHANNEL_ID = :channelid
             ORDER BY SORT_ORDER ASC`,
            { userid: userId, channelid: channelId },
        );
    } catch (err: any) {
        if (isMissingWeekMessagesTableError(err)) {
            return;
        }
        throw err;
    }

    const weekData = await getWeekEventData(userId);
    const messageComponents = buildWeekResponse(weekData);
    const existingMessageIds = rows.map((row) => row.MESSAGE_ID);
    const finalMessageIds = await reconcileWeekMessagesForChannel(
        client,
        channelId,
        existingMessageIds,
        messageComponents,
    );

    if (finalMessageIds.length > 0) {
        await registerWeekMessages(userId, channelId, finalMessageIds);
    }
};
