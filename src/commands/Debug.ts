import { Discord, Slash } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { getUserSelectedCalendars } from "../services/googleCalendarService.js";
import { resetSyncToken, syncCalendarEvents } from "../services/syncService.js";

@Discord()
export class Debug {
    @Slash({ name: "debug_resync", description: "Force a full re-sync of new DB (Admin/Debug only)" })
    async forceResync(interaction: CommandInteraction) {
        if (!interaction.guildId) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

        try {
            const userId = interaction.user.id;
            const calendars = await getUserSelectedCalendars(userId);

            if (calendars.length === 0) {
                const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("No calendars selected."));
                await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
                return;
            }

            const initialContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`Forcing re-sync for ${calendars.length} calendars... this may take a moment.`));
            await interaction.editReply({ components: [initialContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

            let addedCount = 0;
            let updatedCount = 0;
            let canceledCount = 0;
            for (const cal of calendars) {
                // 1. Clear State
                await resetSyncToken(cal.calendarId);
                
                // 2. Trigger Sync
                const result = await syncCalendarEvents(userId, cal.calendarId);
                addedCount += result.addedCount;
                updatedCount += result.updatedCount;
                canceledCount += result.canceledCount;
            }

            const total = addedCount + updatedCount + canceledCount;
            const successContainer = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `Sync Complete. Added: ${addedCount}, Updated: ${updatedCount}, `
                    + `Canceled: ${canceledCount}, Total: ${total}.`,
                ),
            );
            await interaction.editReply({ components: [successContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

        } catch (err: any) {
            console.error(err);
            const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`Error: ${err.message}`));
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
        }
    }
}
