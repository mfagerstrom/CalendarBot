import { google, calendar_v3 } from "googleapis";
import { getAuthenticatedClient } from "./googleAuthService.js";
import { query } from "../lib/db/oracle.js";

export const listReadableCalendars = async (discordUserId: string): Promise<calendar_v3.Schema$CalendarListEntry[]> => {
  const auth = await getAuthenticatedClient(discordUserId);
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const response = await calendar.calendarList.list({
      // removing minAccessRole to see raw list first
      // minAccessRole: "reader", 
    });
    return response.data.items || [];
  } catch (err) {
    console.error(`Failed to list calendars for user ${discordUserId}`, err);
    throw err;
  }
};

export const saveUserCalendarSelection = async (discordUserId: string, calendarId: string, calendarName: string) => {
    // Remove existing selection? Or allow multiple? 
    // For now, let's allow multiple, but maybe offer a way to manage them.
    // The plan says "map users to selected calendar IDs".
    
    // Check if exists
    const checkSql = `SELECT 1 FROM CALENDAR_USER_CALENDARS WHERE DISCORD_USER_ID = :dId AND CALENDAR_ID = :cId`;
    const existing = await query(checkSql, { dId: discordUserId, cId: calendarId });
    
    if (existing.length > 0) {
        // Already exists
        return;
    }

    const sql = `INSERT INTO CALENDAR_USER_CALENDARS (DISCORD_USER_ID, CALENDAR_ID, CALENDAR_NAME) VALUES (:dId, :cId, :cName)`;
    await query(sql, { dId: discordUserId, cId: calendarId, cName: calendarName });
};

export const getUserSelectedCalendars = async (discordUserId: string): Promise<{ calendarId: string, calendarName: string }[]> => {
    const sql = `SELECT CALENDAR_ID, CALENDAR_NAME FROM CALENDAR_USER_CALENDARS WHERE DISCORD_USER_ID = :dId`;
    const rows = await query<any>(sql, { dId: discordUserId });
    
    return rows.map(r => ({
        calendarId: r.CALENDAR_ID,
        calendarName: r.CALENDAR_NAME
    }));
};

export const removeUserCalendarSelection = async (discordUserId: string, calendarId: string) => {
    const sql = `DELETE FROM CALENDAR_USER_CALENDARS WHERE DISCORD_USER_ID = :dId AND CALENDAR_ID = :cId`;
    await query(sql, { dId: discordUserId, cId: calendarId });
};

export const getPrimaryCalendarTimezone = async (discordUserId: string): Promise<string> => {
    const auth = await getAuthenticatedClient(discordUserId);
    const calendar = google.calendar({ version: "v3", auth });
    // Use settings to get the user's global timezone preference
    try {
        const setting = await calendar.settings.get({ setting: 'timezone' });
        return setting.data.value || 'UTC';
    } catch {
        return 'UTC';
    }
};

export const getEventsForTimeRange = async (discordUserId: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<calendar_v3.Schema$Event[]> => {
    // Query DB instead of API to reduce quota usage
    const sql = `
        SELECT * FROM CALENDAR_EVENTS 
        WHERE CALENDAR_ID = :cId 
        AND START_TIME <= :maxT 
        AND END_TIME >= :minT
        ORDER BY START_TIME ASC
    `;
    
    const rows = await query<any>(sql, { 
        cId: calendarId, 
        minT: timeMin, 
        maxT: timeMax 
    });

    return rows.map(row => {
        const isAllDay = !!row.IS_ALL_DAY;
        // Oracle driver returns Date objects for TIMESTAMP
        const startVal = row.START_TIME instanceof Date ? row.START_TIME : new Date(row.START_TIME);
        const endVal = row.END_TIME instanceof Date ? row.END_TIME : new Date(row.END_TIME);
        
        const event: calendar_v3.Schema$Event = {
            id: row.EVENT_ID,
            summary: row.SUMMARY,
            description: row.DESCRIPTION,
            location: row.LOCATION,
            status: row.STATUS,
            htmlLink: row.HTML_LINK,
            start: {},
            end: {}
        };
        
        if (isAllDay) {
            event.start!.date = startVal.toISOString().slice(0, 10);
            event.end!.date = endVal.toISOString().slice(0, 10);
        } else {
            event.start!.dateTime = startVal.toISOString();
            event.end!.dateTime = endVal.toISOString();
        }
        
        return event;
    });
};
