import { google, calendar_v3 } from "googleapis";
import { getAuthenticatedClient } from "./googleAuthService.js";
import { query } from "../lib/db/oracle.js";

// ... existing imports ...

// We need to fetch the authenticated client again here or reuse logic.
// I'll export a helper from this service for that.

// ... existing code ...

const getSyncState = async (calendarId: string): Promise<string | null> => {
    const sql = `SELECT SYNC_TOKEN FROM CALENDAR_SYNC_STATE WHERE CALENDAR_ID = :cId`;
    const rows = await query<any>(sql, { cId: calendarId });
    return rows.length > 0 ? rows[0].SYNC_TOKEN : null;
};

const updateSyncState = async (calendarId: string, syncToken: string) => {
    const sql = `
        MERGE INTO CALENDAR_SYNC_STATE target
        USING (SELECT :cId AS CALENDAR_ID, :tok AS SYNC_TOKEN FROM DUAL) source
        ON (target.CALENDAR_ID = source.CALENDAR_ID)
        WHEN MATCHED THEN
            UPDATE SET target.SYNC_TOKEN = source.SYNC_TOKEN, target.LAST_SYNCED = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (CALENDAR_ID, SYNC_TOKEN, LAST_SYNCED)
            VALUES (source.CALENDAR_ID, source.SYNC_TOKEN, CURRENT_TIMESTAMP)
    `;
    await query(sql, { cId: calendarId, tok: syncToken });
};

export const syncCalendarEvents = async (discordUserId: string, calendarId: string): Promise<calendar_v3.Schema$Event[]> => {
    const auth = await getAuthenticatedClient(discordUserId);
    const calendar = google.calendar({ version: "v3", auth });

    const syncToken = await getSyncState(calendarId);
    
    let pageToken: string | undefined = undefined;
    let newSyncToken: string | undefined | null = null;
    let allEvents: calendar_v3.Schema$Event[] = [];

    // console.log(`Syncing calendar ${calendarId} for user ${discordUserId} (SyncToken: ${syncToken || 'Full Sync'})`);

    do {
        try {
            const params: calendar_v3.Params$Resource$Events$List = {
                calendarId: calendarId,
                singleEvents: true, // Expand recurring events
                pageToken: pageToken,
            };

            if (syncToken) {
                params.syncToken = syncToken;
            } else {
                // If full sync, maybe limit time range? 
                // For now, let's look at future events only to avoid history flood?
                // Actually, full sync usually shouldn't use timeMin if we want *changes*.
                // But for initial load, timeMin is often good practice.
                // CHANGED: Look back 30 days to catch current month context on initial load
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                params.timeMin = thirtyDaysAgo.toISOString();
            }

            const response = await calendar.events.list(params);
            
            if (response.data.items) {
                allEvents = allEvents.concat(response.data.items);
            }
            
            pageToken = response.data.nextPageToken || undefined;
            newSyncToken = response.data.nextSyncToken;

        } catch (err: any) {
             if (err.code === 410) {
                // Sync token invalid (expired), clear and restart full sync
                console.warn(`Sync token for ${calendarId} is invalid. Clearing and retrying full sync.`);
                await updateSyncState(calendarId, ""); // Clear token
                // Recursive call to do full sync immediately
                return syncCalendarEvents(discordUserId, calendarId);
             } else {
                 throw err;
             }
        }
    } while (pageToken);

    if (newSyncToken) {
        await updateSyncState(calendarId, newSyncToken);
        // console.log(`Updated sync token for ${calendarId}`);
    }

    if (allEvents.length > 0) {
        await saveEventsToDB(calendarId, allEvents);
        // console.log(`Found ${allEvents.length} changed events.`);
        // TODO: Process these events (announce them?)
        return allEvents;
    }

    return [];
};

const saveEventsToDB = async (calendarId: string, events: calendar_v3.Schema$Event[]) => {
    for (const event of events) {
        if (!event.id) continue;

        if (event.status === 'cancelled') {
             await query(`DELETE FROM CALENDAR_EVENTS WHERE CALENDAR_ID = :cId AND EVENT_ID = :eId`, 
                { cId: calendarId, eId: event.id });
             continue;
        }

        const isAllDay = event.start?.date ? 1 : 0;
        let startTime: Date | null = null;
        let endTime: Date | null = null;

        if (isAllDay && event.start?.date && event.end?.date) {
            startTime = new Date(event.start.date); 
            endTime = new Date(event.end.date);
        } else if (event.start?.dateTime && event.end?.dateTime) {
            startTime = new Date(event.start.dateTime);
            endTime = new Date(event.end.dateTime);
        }

        if (!startTime) continue; 

        // Oracle query for Merge
        // Note: Oracle's DATE/TIMESTAMP handling can be tricky. JS Date objects usually work with node-oracledb.
        const sql = `
            MERGE INTO CALENDAR_EVENTS target
            USING (SELECT :cId AS CALENDAR_ID, :eId AS EVENT_ID FROM DUAL) source
            ON (target.CALENDAR_ID = source.CALENDAR_ID AND target.EVENT_ID = source.EVENT_ID)
            WHEN MATCHED THEN
                UPDATE SET 
                    SUMMARY = :summary,
                    DESCRIPTION = :descr,
                    START_TIME = :startT,
                    END_TIME = :endT,
                    IS_ALL_DAY = :allDay,
                    LOCATION = :loc,
                    STATUS = :status,
                    HTML_LINK = :link,
                    LAST_UPDATED = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN
                INSERT (CALENDAR_ID, EVENT_ID, SUMMARY, DESCRIPTION, START_TIME, END_TIME, IS_ALL_DAY, LOCATION, STATUS, HTML_LINK)
                VALUES (:cId, :eId, :summary, :descr, :startT, :endT, :allDay, :loc, :status, :link)
        `;

        // Truncate strings to match schema limits if necessary
        const summary = (event.summary || '').substring(0, 1000);
        const descr = (event.description || '').substring(0, 4000);
        const loc = (event.location || '').substring(0, 1000);
        
        await query(sql, {
            cId: calendarId,
            eId: event.id,
            summary,
            descr,
            startT: startTime,
            endT: endTime,
            allDay: isAllDay,
            loc,
            status: event.status || 'confirmed',
            link: event.htmlLink || ''
        });
    }
};

export const getAllUserCalendarSelections = async (): Promise<{ discordUserId: string, calendarId: string, calendarName: string }[]> => {
    const sql = `SELECT DISCORD_USER_ID, CALENDAR_ID, CALENDAR_NAME FROM CALENDAR_USER_CALENDARS`;
    const rows = await query<any>(sql);
    return rows.map(r => ({
        discordUserId: r.DISCORD_USER_ID,
        calendarId: r.CALENDAR_ID,
        calendarName: r.CALENDAR_NAME
    }));
};

export const resetSyncToken = async (calendarId: string) => {
    // Setting to empty string triggers full sync in next run logic (if (syncToken) ...)
    await updateSyncState(calendarId, ""); 
};
