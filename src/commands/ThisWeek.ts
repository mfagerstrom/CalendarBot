import { Discord, Slash } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import {
    getWeekEventData,
    buildWeekResponse,
    registerWeekMessages,
} from "../services/weekService.js";

@Discord()
export class ThisWeek {
    @Slash({ name: "this-week", description: "List all events for the current week (Mon-Sun)" })
    async thisWeek(interaction: CommandInteraction) {
        try {
            if (!interaction.guildId) {
                const container = new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("This command can only be used in a server.")
                );
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                } as any);
                return;
            }

            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 } as any);

            const userId = interaction.user.id;
            
            // 1. Get Week Data
            const weekData = await getWeekEventData(userId);
            
            // 2. Build Response
            const messageComponents = buildWeekResponse(weekData);

            // 3. Send first reply, then follow-ups for additional day cards
            const firstReply = await interaction.editReply({ 
                components: messageComponents[0], 
                flags: MessageFlags.IsComponentsV2 as any 
            });
            const messageIds: string[] = [firstReply.id];

            for (let i = 1; i < messageComponents.length; i++) {
                const followupMessage = await interaction.followUp({
                    components: messageComponents[i],
                    flags: MessageFlags.IsComponentsV2 as any,
                });
                messageIds.push(followupMessage.id);
            }

            if (interaction.channelId) {
                await registerWeekMessages(userId, interaction.channelId, messageIds);
            }

        } catch (err: any) {
            console.error("Error in /this-week command:", err);
            
            try {
                const errorContainer = new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("An error occurred while fetching your weekly events.")
                );

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        components: [errorContainer],
                        flags: MessageFlags.IsComponentsV2 as any,
                    });
                } else {
                    await interaction.reply({
                        components: [errorContainer],
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                    } as any);
                }
            } catch (innerErr) {
                console.warn("Could not send error response to user (likely interaction timeout):", innerErr);
            }
        }
    }
}
