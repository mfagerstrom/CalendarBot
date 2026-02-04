import { Discord, Slash } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { getAuthUrl } from "../lib/google/auth.js";

@Discord()
export class ConnectCommand {
  @Slash({ description: "Connect your Google Calendar to the bot" })
  async connect(interaction: CommandInteraction): Promise<void> {
    try {
      // We defer implicitly or explicitly. Since this is just generating a link, it's fast.
      // However, we want it ephemeral.
      
      // Using a simple state for now (discordUserId). In production, sign this to prevent CSRF.
      const state = interaction.user.id;
      const url = getAuthUrl(state);
      
      console.log(`Generated auth URL for user ${interaction.user.id}: ${url}`);

      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Click this link to authorize the bot to access your Google Calendar:\n${url}\n\nThis link will expire in a short time.`));

      await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      } as any);
    } catch (error) {
      console.error("Error in connect command:", error);
      if (!interaction.replied && !interaction.deferred) {
        const container = new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent("An error occurred while generating the connection link."));

        await interaction.reply({
          components: [container],
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        } as any);
      }
    }
  }
}
