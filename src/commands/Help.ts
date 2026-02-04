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
            new TextDisplayBuilder().setContent("Here are the available commands for viewing your calendar:"),
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("## Viewing Events"),
            new TextDisplayBuilder().setContent("**/today**\nList all events occurring today across your selected calendars."),
        );

    await interaction.reply({
      components: [container],
      flags: (MessageFlags as any).IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }
}
