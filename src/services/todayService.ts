import { 
    getPrimaryCalendarTimezone, 
    getUserSelectedCalendars, 
    getEventsForTimeRange 
} from "./googleCalendarService.js";
import { filterEvents } from "./ignoreService.js";
import { query } from "../lib/db/oracle.js";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { Client } from "discordx";

export const getTodayEventData = async (userId: string) => {
    // 1. Get Timezone
    const timezone = await getPrimaryCalendarTimezone(userId);
    
    // 2. Calculate Start/End
    const todayString = new Date().toLocaleDateString("en-US", { timeZone: timezone });
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
    const todayEvents = allEvents.filter(e => {
        if (!e.start) return false;
        const startStr = e.start.dateTime || e.start.date;
        if (!startStr) return false;
        
        if (e.start.date) {
            const parts = todayString.split('/');
            const isoDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            return e.start.date === isoDate;
        }
        
        const eventDate = new Date(startStr);
        const eventDateString = eventDate.toLocaleDateString("en-US", { timeZone: timezone });
        return eventDateString === todayString;
    });

    // 5.5 Filter Ignored
    const filteredEvents = await filterEvents(userId, todayEvents);

    // 6. Sort
    filteredEvents.sort((a, b) => {
        const tA = new Date(a.start.dateTime || a.start.date).getTime();
        const tB = new Date(b.start.dateTime || b.start.date).getTime();
        return tA - tB;
    });

    return { 
        events: filteredEvents, 
        timezone, 
        todayString 
    };
};

export const buildTodayResponse = (data: any) => {
    if (data.error) {
        const errContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(data.error)
        );
        return [errContainer];
    }

    const { events, timezone, todayString } = data;

    if (events.length === 0) {
         const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`No events found for today (${todayString}) in timezone ${timezone}.`)
         );
         return [emptyContainer];
    }

    const allDay: string[] = [];
    const morning: string[] = [];
    const afternoon: string[] = [];
    const evening: string[] = [];

    for (const event of events) {
        const summary = event.summary || "(No Title)";

        if (event.start.date) {
            allDay.push(`${summary}`);
            continue;
        }

        if (event.start.dateTime) {
            const d = new Date(event.start.dateTime);
            const timeStr = d.toLocaleTimeString("en-US", { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
            
            const hourStr = d.toLocaleTimeString("en-US", { timeZone: timezone, hour: 'numeric', hour12: false });
            const hour = parseInt(hourStr, 10);
            
            const line = `**${timeStr}** - ${summary}`;

            if (hour < 12) {
                morning.push(line);
            } else if (hour < 17) {
                afternoon.push(line);
            } else {
                evening.push(line);
            }
        }
    }

    const dateSubheader = new Date().toLocaleDateString("en-US", { 
        timeZone: timezone, 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
    });

    const container = new ContainerBuilder();
    
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# Today's Events -  ${dateSubheader}`)
    );
    
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
    );

    const formatSection = (title: string, emoji: string, items: string[]) => {
        const content = items.length > 0 ? `>>> ${items.join("\n")}` : ">>> _No events_";
        const header = emoji ? `### ${emoji}⠀${title}` : `### ${title}`;
        return `${header}\n${content}`;
    };

    const sections = [
        { title: "All Day", emoji: "🌅", items: allDay },
        { title: "Morning", emoji: "☕", items: morning },
        { title: "Afternoon", emoji: "☀️", items: afternoon },
        { title: "Evening", emoji: "🌙", items: evening }
    ];

    sections.forEach((section, index) => {
         container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(formatSection(section.title, section.emoji, section.items))
         );

         if (index < sections.length - 1) {
             container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
             );
         }
    });

    return [container];
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
            // Optionally delete from DB if message not found (404)
        }
    }
};
