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

    // 2. Calculate Start (Monday) and End (Sunday) of current week in User TZ
    // We rely on "current time" in the user's timezone to find "today", then rewind to Monday.
    
    // Hacky but effective way to get "local" date parts
    const now = new Date();
    const isoInTz = now.toLocaleString("en-US", { timeZone: timezone });
    const localDate = new Date(isoInTz); // strict local time object

    // Find Monday (Day 1). Sunday is Day 0 in JS.
    // If today is Sunday (0), we want previous Monday (-6 days).
    // If today is Monday (1), we want today (0 days).
    const day = localDate.getDay(); 
    const diffToMonday = localDate.getDate() - day + (day === 0 ? -6 : 1);
    
    const monday = new Date(localDate);
    monday.setDate(diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    // Convert back to real UTC Date objects for the API call?
    // The Google API takes ISO strings. If we pass the constructed dates (which are "local" values but stored in a Date object so they look like UTC or system local), 
    // we need to be careful. 
    // Actually, `getEventsForTimeRange` takes Date objects and calls `toISOString()`.
    // If I created `monday` as "2026-02-02 00:00:00" (system local), and the system is UTC, `toISOString` is fine.
    // BUT if the user is in Tokyo (+9) and I perform math there, I need to ensure the query range covers the absolute time.
    
    // Safer bet: Query a wide range (Just roughly -7 to +7 days from now) and filter precisely in code using the timezone string.
    
    const queryMin = new Date();
    queryMin.setDate(queryMin.getDate() - 7);
    const queryMax = new Date();
    queryMax.setDate(queryMax.getDate() + 14);

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
    
    // Generate the 7 string keys for the week
    const weekMap = new Map<string, any[]>();
    const dateHeaders = new Map<string, string>(); // "2026-02-02" -> "Monday, Feb 2"
    
    // const cursor = new Date(monday);
    for (let i = 0; i < 7; i++) {
        // We need to shift the 'cursor' carefully to mimic the User TZ stepping
        // Best way: Create a date object or string for that specific day in the TZ.
        
        // Let's iterate using the `monday` object we built. Ideally we should reconstruct it properly.
        // Actually, let's just use the `toLocaleDateString` logic directly.
        // If we step 24h at a time, we might hit DST issues.
        // Safer: add `i` days to the base date.
        
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        
        // This 'd' is a fake local date object. 
        // We can't use "timeZone: timezone" on it because it IS already shifted (conceptually).
        // Let's just assume "YYYY-MM-DD" from its own getFullYear/etc is the key.
        const key = d.toISOString().split('T')[0];
        
        const header = d.toLocaleDateString("en-US", { weekday: 'long', month: 'short', day: 'numeric' });
        
        weekMap.set(key, []);
        dateHeaders.set(key, header);
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
        startLabel: dateHeaders.get(Array.from(dateHeaders.keys())[0]),
        endLabel: dateHeaders.get(Array.from(dateHeaders.keys())[6])
    };
};

export const buildWeekResponse = (data: any) => {
    if (data.error) {
        return [[buildSimpleTextContainer(data.error)]];
    }

    const { weekMap, dateHeaders, timezone } = data;

    const messageComponents: ContainerBuilder[][] = [];
    const allWeekEvents = Array.from(weekMap.values()).flat();
    if (allWeekEvents.length === 0) {
        return [[buildSimpleTextContainer("No events found for this week.")]];
    }

    for (const [key, events] of weekMap.entries()) {
        if (events.length === 0) {
            continue;
        }
        const headerTitle = dateHeaders.get(key) || "Day";
        const dayContainer = buildEventSectionsContainer({
            header: `# ${headerTitle}`,
            events,
            timezone,
        });
        messageComponents.push([dayContainer]);
    }

    return messageComponents.length > 0
        ? messageComponents
        : [[buildSimpleTextContainer("No events found for this week.")]];
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
