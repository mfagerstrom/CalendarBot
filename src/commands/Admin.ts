import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { addIgnorePattern, getIgnorePatterns, removeIgnorePattern } from "../services/ignoreService.js";
import { ApplicationCommandOptionType } from "discord.js";

@Discord()
@SlashGroup({ description: "Admin commands", name: "admin" })
@SlashGroup("admin")
@SlashGroup({ description: "Manage ignore patterns", name: "ignore", root: "admin" })
export class AdminCommand {

  @SlashGroup("ignore", "admin")
  @Slash({ description: "Add a text pattern to ignore in event titles" })
  async add(
    @SlashOption({
        description: "The text pattern to ignore (case-insensitive substring)",
        name: "pattern",
        required: true,
        type: ApplicationCommandOptionType.String,
    })
    pattern: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

    try {
      await addIgnorePattern(interaction.user.id, pattern);

      const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`✅ Added ignore pattern: "${pattern}"`)
      );

      await interaction.editReply({ 
        components: [container], 
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 
      } as any);

    } catch (error) {
      console.error(error);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Failed to add pattern.")
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
    }
  }

  @SlashGroup("ignore", "admin")
  @Slash({ description: "List your ignore patterns" })
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

    try {
      const patterns = await getIgnorePatterns(interaction.user.id);
      
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("# Ignore Patterns")
      );
      
      if (patterns.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No active ignore patterns.")
        );
      } else {
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
          
          const listText = patterns.map(p => `\`ID: ${p.id}\` - "${p.pattern}"`).join("\n");
          container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(listText)
          );
      }

      await interaction.editReply({ 
         components: [container], 
         flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 
      } as any);

    } catch (error) {
      console.error(error);
       const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Failed to list patterns.")
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
    }
  }

  @SlashGroup("ignore", "admin")
  @Slash({ description: "Remove an ignore pattern by ID" })
  async remove(
      @SlashOption({
        description: "The ID of the pattern to remove (use /admin ignore list to find IDs)",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Number,
    })
    id: number,
    interaction: CommandInteraction
  ): Promise<void> {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

      try {
          await removeIgnorePattern(interaction.user.id, id);
          
          const container = new ContainerBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`✅ Removed pattern ID ${id}.`)
          );
          
           await interaction.editReply({ 
            components: [container], 
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 
          } as any);
      } catch (error) {
           console.error(error);
            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent("Failed to remove pattern.")
            );
            await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
      }
  }
}
