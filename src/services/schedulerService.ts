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
import { processReminders, refreshActiveReminderMessages } from "./reminderService.js";
import { ensureHelpWantedMessage } from "./helpWantedService.js";
import { ensureArrangementQueueMessage } from "./arrangementQueueService.js";
import { startGroceryListSyncService } from "./groceryListService.js";
import { startMikeTodoListSyncService } from "./mikeTodoListService.js";
import { TextChannel } from "discord.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INVALID_GRANT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
let lastCheckedDate = new Date().toDateString();
const invalidGrantAlertTimes = new Map<string, number>();

const isInvalidGrantError = (err: unknown): boolean => {
    if (!err || typeof err !== "object") {
        return false;
    }

    const errObj = err as {
        message?: unknown;
        response?: { data?: { error?: unknown } };
    };
    const responseError = String(errObj.response?.data?.error ?? "").toLowerCase();
    if (responseError === "invalid_grant") {
        return true;
    }

    const message = String(errObj.message ?? "").toLowerCase();
    return message.includes("invalid_grant");
};

const sendInvalidGrantAlert = async (
    client: Client,
    discordUserId: string,
    calendarId: string,
): Promise<void> => {
    const alertKey = `${discordUserId}:${calendarId}`;
    const now = Date.now();
    const lastAlert = invalidGrantAlertTimes.get(alertKey) ?? 0;
    if ((now - lastAlert) < INVALID_GRANT_ALERT_COOLDOWN_MS) {
        return;
    }

    const channel = await client.channels.fetch(CHANNELS.BOT_LOGS).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        return;
    }

    const content =
        `<@${USERS.MIKE}> OAuth refresh failed for calendar sync.\n`
        + `User: <@${discordUserId}> (\`${discordUserId}\`)\n`
        + `Calendar ID: \`${calendarId}\`\n`
        + "Google returned `invalid_grant`. Re-run `/connect` for this user.";

    await (channel as TextChannel).send({
        content,
        allowedMentions: { parse: ["users", "everyone"] },
    });

    invalidGrantAlertTimes.set(alertKey, now);
};

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
                await ensureHelpWantedMessage(client, CHANNELS.HELP_WANTED);
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
                    if (isInvalidGrantError(err)) {
                        try {
                            await sendInvalidGrantAlert(client, sub.discordUserId, sub.calendarId);
                        } catch (alertErr) {
                            console.error("Failed to send invalid_grant alert:", alertErr);
                        }
                    }
                }
            }

            for (const userId of usersWithChanges) {
                console.log(`[Scheduler] Triggering live update for user ${userId}...`);
                await updateUserTodayMessages(userId, client);
                await updateUserWeekMessages(userId, client);
            }

            await processReminders(client);
            await ensureArrangementQueueMessage(client, CHANNELS.ARRANGEMENTS_QUEUE);

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
            await ensureArrangementQueueMessage(client, CHANNELS.ARRANGEMENTS_QUEUE);
            await refreshActiveReminderMessages(client);
            startGroceryListSyncService(client, CHANNELS.GROCERY_LIST);
            startMikeTodoListSyncService(client, CHANNELS.TODO_LIST);
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
