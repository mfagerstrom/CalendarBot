import { Discord, Slash } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { getAuthUrl } from "../lib/google/auth.js";

@Discord()
export class ConnectCommand {
  @Slash({ description: "Connect your Google Calendar to the bot" })
  async connect(interaction: CommandInteraction): Promise<void> {
    // We defer implicitly or explicitly. Since this is just generating a link, it's fast.
    // However, we want it ephemeral.
    
    // Using a simple state for now (discordUserId). In production, sign this to prevent CSRF.
    const state = interaction.user.id;
    const url = getAuthUrl(state);

    await interaction.reply({
      content: `Click this link to authorize the bot to access your Google Calendar:\n${url}\n\nThis link will expire in a short time.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
