import { CommandInteraction, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { Discord, Slash, SlashGroup, SelectMenuComponent } from "discordx";
import { getUserSelectedCalendars, listReadableCalendars, removeUserCalendarSelection, saveUserCalendarSelection } from "../services/googleCalendarService.js";

@Discord()
@SlashGroup({ description: "Manage your connected calendars", name: "calendars" })
@SlashGroup("calendars")
export class CalendarsCommand {

  @Slash({ description: "List your currently synced calendars" })
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);

    try {
      const selections = await getUserSelectedCalendars(interaction.user.id);
      
      if (selections.length === 0) {
        const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("You have not selected any calendars to sync yet. Use `/calendars choose` to get started."));
        await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
        return;
      }

      const container = new ContainerBuilder();
      
      container.addTextDisplayComponents(
         new TextDisplayBuilder().setContent("# Synced Calendars")
      );
      
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
      );
      
      const listContent = selections.map(c => `• **${c.calendarName}**`).join("\n");
      container.addTextDisplayComponents(
         new TextDisplayBuilder().setContent(listContent)
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
    } catch (error) {
        console.error(error);
        const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("An error occurred while fetching your calendars. checking logs."));
        await interaction.editReply({ components: [errorContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
    }
  }

  @Slash({ description: "Choose a calendar to sync from your Google Account" })
  async choose(interaction: CommandInteraction): Promise<void> {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
      
      try {
          const calendars = await listReadableCalendars(interaction.user.id);
          
          if (calendars.length === 0) {
              const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("No calendars found on your Google Account."));
              await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
              return;
          }

          // Limit to 25 items for select menu
          const options = calendars.slice(0, 25).map(cal => {
              const builder = new StringSelectMenuOptionBuilder()
                .setLabel((cal.summary || "Untitled Calendar").substring(0, 100))
                .setValue(cal.id || "unknown");
              
              const desc = cal.description ? cal.description.substring(0, 100) : (cal.primary ? "Primary Calendar" : undefined);
              if (desc) {
                  builder.setDescription(desc);
              }
              return builder;
          });

          const select = new StringSelectMenuBuilder()
            .setCustomId("calendar-add-selection")
            .setPlaceholder("Select a calendar to sync")
            .addOptions(options);

          const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

          const container = new ContainerBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent("Select the calendar you want to sync messages from:"))
              .addActionRowComponents(row);

          await interaction.editReply({
              components: [container],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);

      } catch (error: any) {
          console.error("Error fetching calendars", error);
          let errorMsg = "An error occurred. Check bot logs.";
          if (error.message.includes("User is not connected")) {
              errorMsg = "You are not connected to Google yet. Use `/connect` first.";
          }
           const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(errorMsg));
           await interaction.editReply({ components: [errorContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
      }
  }

  @SelectMenuComponent({ id: "calendar-add-selection" })
  async handleCalendarSelection(interaction: StringSelectMenuInteraction): Promise<void> {
      await interaction.deferUpdate();
      
      const calendarId = interaction.values[0];
      // We need the name, but the value is just ID.
      // We could re-fetch, or encode name in value (bad idea if special chars).
      // Let's re-fetch the list to get the name safely and verify access.
      
      try {
          const calendars = await listReadableCalendars(interaction.user.id);
          const selected = calendars.find(c => c.id === calendarId);
          
          if (!selected) {
              const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Could not find the selected calendar. Try running `/calendars choose` again."));
              await interaction.followUp({
                  components: [container],
                  flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
              } as any);
              return;
          }
          
          const name = selected.summary || "Untitled";
          
          await saveUserCalendarSelection(interaction.user.id, calendarId, name);
          
          const successContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`✅ Successfully added **${name}** to your sync list!`));
          
          await interaction.editReply({
              components: [successContainer],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);
          
      } catch (error) {
          console.error("Error saving selection", error);
          const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to save selection."));
          await interaction.followUp({
              components: [errorContainer], 
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);
      }
  }

  @Slash({ description: "Remove a calendar from sync" })
  async remove(interaction: CommandInteraction): Promise<void> {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
      
       try {
          const selections = await getUserSelectedCalendars(interaction.user.id);
          
          if (selections.length === 0) {
              const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("You have no calendars to remove."));
              await interaction.editReply({ components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
              return;
          }

          const options = selections.slice(0, 25).map(cal => 
               new StringSelectMenuOptionBuilder()
                .setLabel(cal.calendarName)
                .setValue(cal.calendarId)
          );

          const select = new StringSelectMenuBuilder()
            .setCustomId("calendar-remove-selection")
            .setPlaceholder("Select a calendar to remove")
            .addOptions(options);

          const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

          const container = new ContainerBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent("Select the calendar to remove:"))
              .addActionRowComponents(row);

          await interaction.editReply({
              components: [container],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);

       } catch (error) {
           console.error(error);
           const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Error loading calendars."));
           await interaction.editReply({ components: [errorContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 } as any);
       }
  }

  @SelectMenuComponent({ id: "calendar-remove-selection" })
  async handleCalendarRemoval(interaction: StringSelectMenuInteraction): Promise<void> {
      await interaction.deferUpdate();
      const calendarId = interaction.values[0];
      
      try {
          await removeUserCalendarSelection(interaction.user.id, calendarId);
          
           const successContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`🗑️ Calendar removed from sync list.`));
           await interaction.editReply({
              components: [successContainer],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);
      } catch (error) {
          console.error("Error removing calendar", error);
          const errorContainer = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to remove calendar."));
          await interaction.followUp({
              components: [errorContainer], 
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
          } as any);
      }
  }
}
