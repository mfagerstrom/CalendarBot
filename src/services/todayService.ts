import { 
    getUserSelectedCalendars, 
    getEventsForTimeRange 
} from "./googleCalendarService.js";
import { filterEvents } from "./ignoreService.js";
import { query } from "../lib/db/oracle.js";
import { buildEventSectionsContainer, buildSimpleTextContainer } from "./eventUiService.js";
import {
    addDaysToYmd,
    getYmdInTimezone,
    toAllDayEventForYmd,
} from "./eventDateUtils.js";
import { CHANNELS } from "../config/channels.js";
import { Client } from "discordx";
import { applyReminderFlags, getReminderRules } from "./reminderService.js";

export const getTodayEventData = async (userId: string) => {
    // 1. Get Timezone
    const timezone = "America/New_York";
    
    // 2. Calculate Start/End
    const todayString = new Date().toLocaleDateString("en-US", { timeZone: timezone });
    const todayIso = getYmdInTimezone(new Date(), timezone);
    const timeMin = new Date();
    timeMin.setHours(timeMin.getHours() - 24);
    const timeMax = new Date();
    timeMax.setHours(timeMax.getHours() + 24);
    
    // 3. Get Calendars
    const calendars = await getUserSelectedCalendars(userId);
    if (calendars.length === 0) {
        return { error: "No calendars selected." };
    }

    // 4. Fetch Events
    const allEvents: any[] = [];
    for (const cal of calendars) {
        try {
            const events = await getEventsForTimeRange(userId, cal.calendarId, timeMin, timeMax);
            allEvents.push(...events);
        } catch (e) {
            console.error(`Failed to fetch for ${cal.calendarName}`, e);
        }
    }

    // 5. Filter for "Today"
    const todayEvents = allEvents
        .map((event) => {
            if (!event.start) {
                return null;
            }

            if (event.start.date) {
                const startYmd = event.start.date;
                const endExclusiveYmd = event.end?.date || addDaysToYmd(startYmd, 1);
                if (todayIso >= startYmd && todayIso < endExclusiveYmd) {
                    return toAllDayEventForYmd(event, todayIso);
                }
                return null;
            }

            if (event.start.dateTime) {
                const startYmd = getYmdInTimezone(new Date(event.start.dateTime), timezone);
                const endYmd = event.end?.dateTime
                    ? getYmdInTimezone(new Date(event.end.dateTime), timezone)
                    : startYmd;

                if (todayIso < startYmd || todayIso > endYmd) {
                    return null;
                }

                if (startYmd !== endYmd) {
                    return toAllDayEventForYmd(event, todayIso);
                }

                return event;
            }

            return null;
        })
        .filter((event): event is any => !!event);

    // 5.5 Filter Ignored
    const filteredEvents = await filterEvents(userId, todayEvents);

    const reminderRules = await getReminderRules();
    const flaggedEvents = applyReminderFlags(filteredEvents, reminderRules);

    // 6. Sort
    flaggedEvents.sort((a, b) => {
        const tA = new Date(a.start.dateTime || a.start.date).getTime();
        const tB = new Date(b.start.dateTime || b.start.date).getTime();
        return tA - tB;
    });

    return { 
        events: flaggedEvents, 
        timezone, 
        todayString 
    };
};

export const buildTodayResponse = (data: any) => {
    if (data.error) {
        return [buildSimpleTextContainer(data.error)];
    }

    const { events, timezone, todayString } = data;

    if (events.length === 0) {
        return [
            buildSimpleTextContainer(
                `No events found for today (${todayString}) in timezone ${timezone}.`,
            ),
        ];
    }

    const dateSubheader = new Date().toLocaleDateString("en-US", { 
        timeZone: timezone, 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
    });

    return [buildEventSectionsContainer({
        header: `# Today's Events -  ${dateSubheader}`,
        events,
        timezone,
    })];
};

export const registerTodayMessage = async (userId: string, channelId: string, messageId: string) => {
    // Upsert logic (Oracle MERGE)
    const sql = `
        MERGE INTO CALENDAR_TodayMessages target
        USING (SELECT :userid AS USER_ID, :channelid AS CHANNEL_ID, :messageid AS MESSAGE_ID FROM DUAL) source
        ON (target.USER_ID = source.USER_ID AND target.CHANNEL_ID = source.CHANNEL_ID)
        WHEN MATCHED THEN
            UPDATE SET target.MESSAGE_ID = source.MESSAGE_ID, target.UPDATED_AT = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (USER_ID, CHANNEL_ID, MESSAGE_ID, CREATED_AT, UPDATED_AT)
            VALUES (source.USER_ID, source.CHANNEL_ID, source.MESSAGE_ID, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    await query(sql, { userid: userId, channelid: channelId, messageid: messageId });
};

export const ensureStaticTodayMessage = async (client: Client, userId: string, channelId: string) => {
    // 1. Check if we already have a record
    const rows = await query<any>(
        `SELECT MESSAGE_ID FROM CALENDAR_TodayMessages WHERE USER_ID = :userid AND CHANNEL_ID = :channelid`,
        { userid: userId, channelid: channelId }
    );

    const messageId = rows.length > 0 ? rows[0].MESSAGE_ID : null;
    let needsCreation = !messageId;

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    // 2. If we have a messageId, verify it still exists in Discord
    if (messageId) {
        try {
            await channel.messages.fetch(messageId);
        } catch (e: any) {
            // If 404 (Unknown Message), we need to recreate
            if (e.code === 10008) {
                console.log("Static Today message missing in channel, recreating...");
                needsCreation = true;
            } else {
                throw e;
            }
        }
    }

    // 3. Create if needed
    if (needsCreation) {
        // Clear old stale references if any
        if (messageId) {
             await query(`DELETE FROM CALENDAR_TodayMessages WHERE MESSAGE_ID = :mid`, { mid: messageId });
        }

        // Generate content
        const data = await getTodayEventData(userId);
        const components = buildTodayResponse(data);
        const IS_COMPONENTS_V2 = 1 << 15;

        // Send new message
        const message = await (channel as any).send({
            components: components,
            flags: IS_COMPONENTS_V2 as any
        });

        // Register
        await registerTodayMessage(userId, channelId, message.id);
    }
};

export const forceUpdateAllTodayMessages = async (client: Client) => {
    // Get all unique users who have active messages
    const rows = await query<any>(`SELECT DISTINCT USER_ID FROM CALENDAR_TodayMessages`);
    
    console.log(`Force-updating Today messages for ${rows.length} users (Midnight Rollover)...`);

    for (const row of rows) {
        await updateUserTodayMessages(row.USER_ID, client);
    }
};

export const updateUserTodayMessages = async (userId: string, client: Client) => {
    const rows = await query<any>(
        `SELECT CHANNEL_ID, MESSAGE_ID FROM CALENDAR_TodayMessages WHERE USER_ID = :userid`,
        { userid: userId }
    );

    if (rows.length === 0) return;

    console.log(`[LiveUpdate] Found ${rows.length} registered Today message(s) to update for user ${userId}.`);

    // Fetch data once
    const data = await getTodayEventData(userId);
    const components = buildTodayResponse(data);
    const IS_COMPONENTS_V2 = 1 << 15; // Defining here as well

    for (const row of rows) {
        try {
            const channel = await client.channels.fetch(row.CHANNEL_ID);
            if (!channel || !channel.isTextBased()) {
                 console.log(`[LiveUpdate] Channel ${row.CHANNEL_ID} unavailable.`);
                 await query(
                    `DELETE FROM CALENDAR_TodayMessages WHERE USER_ID = :userid AND CHANNEL_ID = :channelid`,
                    { userid: userId, channelid: row.CHANNEL_ID },
                 );
                 continue;
            }
            
            // We need to fetch the message to edit it
            const message = await (channel as any).messages.fetch(row.MESSAGE_ID);
            if (message) {
                await message.edit({
                    components: components,
                    flags: IS_COMPONENTS_V2 as any // Cast for D.js compat
                });
                console.log(`[LiveUpdate] Successfully edited message ${row.MESSAGE_ID} in channel ${row.CHANNEL_ID}.`);
            }
        } catch (err: any) {
            console.error(`[LiveUpdate] Failed to update message ${row.MESSAGE_ID} in channel ${row.CHANNEL_ID}: ${err.message}`);

            if (err?.code === 10008 || err?.code === 10003) {
                await query(
                    `DELETE FROM CALENDAR_TodayMessages WHERE USER_ID = :userid AND CHANNEL_ID = :channelid`,
                    { userid: userId, channelid: row.CHANNEL_ID },
                );
                console.log(
                    `[LiveUpdate] Removed stale Today registration for user ${userId} in channel ${row.CHANNEL_ID}.`,
                );

                if (err?.code === 10008 && row.CHANNEL_ID === CHANNELS.TODAY) {
                    try {
                        await ensureStaticTodayMessage(client, userId, row.CHANNEL_ID);
                        console.log(
                            `[LiveUpdate] Reposted static Today message in channel ${row.CHANNEL_ID}.`,
                        );
                    } catch (repostErr) {
                        console.error("Failed to repost static Today message:", repostErr);
                    }
                }
            }
        }
    }
};
