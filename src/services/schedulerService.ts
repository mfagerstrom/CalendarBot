import { getAllUserCalendarSelections, syncCalendarEvents } from "./syncService.js";
import { updateUserTodayMessages, ensureStaticTodayMessage, forceUpdateAllTodayMessages } from "./todayService.js";
import {
    updateUserWeekMessages,
    forceUpdateAllWeekMessages,
    ensureStaticWeekMessages,
} from "./weekService.js";
import { USERS } from "../config/users.js";
import { Client } from "discordx";
import { processReminders, refreshActiveReminderMessages } from "./reminderService.js";
import { ensureHelpWantedMessage } from "./helpWantedService.js";
import { ensureArrangementQueueMessage } from "./arrangementQueueService.js";
import { startGroceryListSyncService } from "./groceryListService.js";
import { startMikeTodoListSyncService } from "./mikeTodoListService.js";
import { getGuildChannelId, listKnownGuildIds } from "./guildChannelConfigService.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCheckedDate = new Date().toDateString();

export const startCalendarSyncService = (client: Client) => {
    console.log("Starting Calendar Sync Service...");

    const syncStaticGuildContent = async (): Promise<void> => {
        const guildIds = await listKnownGuildIds(client);
        for (const guildId of guildIds) {
            try {
                const todayChannelId = await getGuildChannelId(guildId, "TODAY");
                const weekChannelId = await getGuildChannelId(guildId, "THIS_WEEK");
                const helpWantedChannelId = await getGuildChannelId(guildId, "HELP_WANTED");
                const arrangementQueueChannelId = await getGuildChannelId(guildId, "ARRANGEMENTS_QUEUE");
                const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");

                await ensureStaticTodayMessage(client, USERS.MIKE, todayChannelId);
                await ensureStaticWeekMessages(client, USERS.MIKE, weekChannelId);
                await ensureHelpWantedMessage(client, helpWantedChannelId);
                await ensureArrangementQueueMessage(client, arrangementQueueChannelId);
                await refreshActiveReminderMessages(client, reminderChannelId);
            } catch (err) {
                console.error(`Failed to ensure static content for guild ${guildId}:`, err);
            }
        }
    };

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

            await syncStaticGuildContent();

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

            const guildIds = await listKnownGuildIds(client);
            for (const guildId of guildIds) {
                try {
                    const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");
                    const arrangementQueueChannelId = await getGuildChannelId(
                        guildId,
                        "ARRANGEMENTS_QUEUE",
                    );
                    await processReminders(client, reminderChannelId);
                    await ensureArrangementQueueMessage(client, arrangementQueueChannelId);
                } catch (err) {
                    console.error(`Failed reminder/arrangement sync for guild ${guildId}:`, err);
                }
            }

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

    const runStartup = async () => {
        try {
            await syncStaticGuildContent();

            startGroceryListSyncService(client, async () => {
                const guildIds = await listKnownGuildIds(client);
                const channelIds = await Promise.all(
                    guildIds.map((guildId) => getGuildChannelId(guildId, "GROCERY_LIST")),
                );
                return Array.from(new Set(channelIds.filter(Boolean)));
            });

            startMikeTodoListSyncService(client, async () => {
                const guildIds = await listKnownGuildIds(client);
                const channelIds = await Promise.all(
                    guildIds.map((guildId) => getGuildChannelId(guildId, "TODO_LIST")),
                );
                return Array.from(new Set(channelIds.filter(Boolean)));
            });
        } catch (err) {
            console.error("Failed to run startup refresh tasks:", err);
        }

        // Run shortly after startup
        setTimeout(runSync, 10000);

        // Schedule
        setInterval(runSync, SYNC_INTERVAL_MS);
    };

    void runStartup();
};
