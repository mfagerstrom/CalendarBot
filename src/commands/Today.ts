import { Discord, Slash } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { registerTodayMessage, getTodayEventData, buildTodayResponse } from "../services/todayService.js";

const IS_COMPONENTS_V2 = 1 << 15;

@Discord()
export class Today {
    @Slash({ name: "today", description: "List all events occurring today across your selected calendars" })
    async today(interaction: CommandInteraction) {
        try {
            if (!interaction.guildId) {
                const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("This command can only be used in a server."));
                await interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 } as any);
                return;
            }

            await interaction.deferReply({ flags: IS_COMPONENTS_V2 } as any);

            const userId = interaction.user.id;
            
            // 1. Get Today Data
            const todayData = await getTodayEventData(userId);
            
            // 2. Build Response
            const containers = buildTodayResponse(todayData);

            // 3. Send Reply
            const reply = await interaction.editReply({ 
                components: containers, 
                flags: IS_COMPONENTS_V2 as any 
            });

            // 4. Register Message for Updates
            await registerTodayMessage(userId, interaction.channelId, reply.id);

        } catch (err: any) {
            console.error("Error in /today command:", err);
            const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("An error occurred while fetching your events."));
            await interaction.editReply({ components: [errorContainer] });
        }
    }
}
