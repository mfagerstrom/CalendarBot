import { getAllUserCalendarSelections, syncCalendarEvents } from "./syncService.js";
import { updateUserTodayMessages, ensureStaticTodayMessage, forceUpdateAllTodayMessages } from "./todayService.js";
import { CHANNELS } from "../config/channels.js";
import { USERS } from "../config/users.js";
import { Client } from "discordx";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCheckedDate = new Date().toDateString();

export const startCalendarSyncService = (client: Client) => {
    console.log("Starting Calendar Sync Service...");

    const runSync = async () => {
        try {
            // 1. Midnight Rollover Check
            const now = new Date();
            const currentDate = now.toDateString();
            if (currentDate !== lastCheckedDate) {
                console.log(`Detected date change: ${lastCheckedDate} -> ${currentDate}. Triggering refresh.`);
                await forceUpdateAllTodayMessages(client);
                lastCheckedDate = currentDate;
            }

            // 2. Ensure Static Channel (Single Copy)
            try {
                // Ensure MIKE's calendar is in the TODAY channel
                await ensureStaticTodayMessage(client, USERS.MIKE, CHANNELS.TODAY);
            } catch (err) {
                console.error("Failed to ensure static today message:", err);
            }

            // 3. Standard Sync Loop
            const allSelections = await getAllUserCalendarSelections();
            // console.log(`Running sync for ${allSelections.length} calendar subscriptions...`);

            // We can group by User to reuse Auth client?
            // For now, simple iteration.
            
            for (const sub of allSelections) {
                try {
                    const changes = await syncCalendarEvents(sub.discordUserId, sub.calendarId);
                    if (changes && changes.length > 0) {
                        const msg = `Found ${changes.length} updates for calendar **${sub.calendarName}** (User: ${sub.discordUserId})`;
                        console.log(msg);
                        
                        // Temporary: List changes to log
                        for (const event of changes) {
                            const status = event.status; // confirmed, cancelled
                            const summary = event.summary || "No Title";
                            const start = event.start?.dateTime || event.start?.date;
                            console.log(`- [${status}] ${summary} @ ${start}`);
                        }

                        // Trigger live update for this user
                        console.log(`[Scheduler] Triggering live update for user ${sub.discordUserId}...`);
                        await updateUserTodayMessages(sub.discordUserId, client);
                    }
                } catch (err) {
                    console.error(`Error syncing calendar ${sub.calendarName} for user ${sub.discordUserId}:`, err);
                }
            }
        } catch (err) {
            console.error("Critical error in sync loop:", err);
        }
    };

    // Run immediately on start (or maybe delay slightly)
    setTimeout(runSync, 10000);

    // Schedule
    setInterval(runSync, SYNC_INTERVAL_MS);
};
