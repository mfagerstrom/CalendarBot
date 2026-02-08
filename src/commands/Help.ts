import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { Discord, Slash } from "discordx";
import { SeparatorSpacingSize } from "discord-api-types/v10";

@Discord()
export class Help {
  @Slash({ description: "Show available commands and usage" })
  async help(interaction: CommandInteraction): Promise<void> {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("# CalendarBot Help"),
            new TextDisplayBuilder().setContent("Use /today to see today's events."),
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("## /today"),
            new TextDisplayBuilder().setContent("Shows events in your selected calendars for today."),
        );

    await interaction.reply({
      components: [container],
      flags: (MessageFlags as any).IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
