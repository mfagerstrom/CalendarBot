import { getAllUserCalendarSelections, syncCalendarEvents } from "./syncService.js";
import { updateUserTodayMessages, ensureStaticTodayMessage, forceUpdateAllTodayMessages } from "./todayService.js";
import {
    updateUserWeekMessages,
    forceUpdateAllWeekMessages,
    ensureStaticWeekMessages,
} from "./weekService.js";
import { CHANNELS } from "../config/channels.js";
import { USERS } from "../config/users.js";
import { Client } from "discordx";
import { processReminders } from "./reminderService.js";

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
                await forceUpdateAllWeekMessages(client);
                lastCheckedDate = currentDate;
            }

            // 2. Ensure Static Channel (Single Copy)
            try {
                // Ensure MIKE's calendar is in the TODAY channel
                await ensureStaticTodayMessage(client, USERS.MIKE, CHANNELS.TODAY);
                await ensureStaticWeekMessages(client, USERS.MIKE, CHANNELS.THIS_WEEK);
            } catch (err) {
                console.error("Failed to ensure static calendar messages:", err);
            }

            // 3. Standard Sync Loop
            const allSelections = await getAllUserCalendarSelections();
            // console.log(`Running sync for ${allSelections.length} calendar subscriptions...`);

            // We can group by User to reuse Auth client?
            // For now, simple iteration.
            let runAddedCount = 0;
            let runUpdatedCount = 0;
            let runCanceledCount = 0;
            let calendarsWithChanges = 0;
            const usersWithChanges = new Set<string>();
            
            for (const sub of allSelections) {
                try {
                    const result = await syncCalendarEvents(sub.discordUserId, sub.calendarId);
                    if (result.totalChanges > 0) {
                        runAddedCount += result.addedCount;
                        runUpdatedCount += result.updatedCount;
                        runCanceledCount += result.canceledCount;
                        calendarsWithChanges += 1;
                        usersWithChanges.add(sub.discordUserId);
                    }
                } catch (err) {
                    console.error(`Error syncing calendar ${sub.calendarName} for user ${sub.discordUserId}:`, err);
                }
            }

            for (const userId of usersWithChanges) {
                console.log(`[Scheduler] Triggering live update for user ${userId}...`);
                await updateUserTodayMessages(userId, client);
                await updateUserWeekMessages(userId, client);
            }

            await processReminders(client);

            if (calendarsWithChanges > 0) {
                console.log(
                    `[Sync] ${calendarsWithChanges} calendar(s) changed: `
                    + `added=${runAddedCount}, updated=${runUpdatedCount}, canceled=${runCanceledCount}.`,
                );
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
