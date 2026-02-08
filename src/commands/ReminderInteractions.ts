import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent } from "discordx";
import {
  buildConfirmedComponents,
  buildSnoozedResponse,
  buildReminderPromptUpdate,
  completeOccurrenceWithArrangements,
  getOccurrenceById,
  getReminderRules,
  parseReminderId,
  REMINDER_ACK_REGEX,
  REMINDER_ARRANGEMENTS_REGEX,
  REMINDER_SNOOZE_REGEX,
  snoozeOccurrence,
} from "../services/reminderService.js";
import { buildComponentsV2Flags, safeReply, safeUpdate } from "../lib/discord/interactionUtils.js";
import { CHANNELS } from "../config/channels.js";

@Discord()
export class ReminderInteractions {
  @ButtonComponent({ id: REMINDER_ACK_REGEX })
  async acknowledge(interaction: ButtonInteraction): Promise<void> {
    const occurrenceId = parseReminderId(interaction.customId, "reminder-ack");
    if (!occurrenceId) {
      await safeUpdate(interaction, {
        components: buildReminderPromptUpdate("This reminder is no longer active.").components,
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const occurrence = await getOccurrenceById(occurrenceId);
    if (!occurrence) {
      await safeUpdate(interaction, {
        components: buildReminderPromptUpdate("This reminder is no longer active.").components,
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`reminder-arrangements:${occurrenceId}`)
      .setTitle("Arrangements Made")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("arrangements-notes")
            .setLabel("What arrangements were made?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: REMINDER_SNOOZE_REGEX })
  async snooze(interaction: ButtonInteraction): Promise<void> {
    const occurrenceId = parseReminderId(interaction.customId, "reminder-snooze");
    if (!occurrenceId) {
      await safeUpdate(interaction, {
        components: buildReminderPromptUpdate("This reminder is no longer active.").components,
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const occurrence = await getOccurrenceById(occurrenceId);
    if (!occurrence) {
      await safeUpdate(interaction, {
        components: buildReminderPromptUpdate("This reminder is no longer active.").components,
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    await snoozeOccurrence(occurrenceId);

    await safeUpdate(interaction, {
      components: buildSnoozedResponse().components,
      flags: buildComponentsV2Flags(false),
    });
  }

  @ModalComponent({ id: REMINDER_ARRANGEMENTS_REGEX })
  async submitArrangements(interaction: any): Promise<void> {
    const occurrenceId = parseReminderId(interaction.customId, "reminder-arrangements");
    if (!occurrenceId) {
      const payload = buildReminderPromptUpdate("This reminder is no longer active.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const occurrence = await getOccurrenceById(occurrenceId);
    if (!occurrence) {
      const payload = buildReminderPromptUpdate("This reminder is no longer active.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const rawNotes = interaction.fields.getTextInputValue("arrangements-notes");
    const arrangementsNotes = rawNotes.replace(/\s+/g, " ").trim();
    await completeOccurrenceWithArrangements(occurrenceId, arrangementsNotes);

    const rules = await getReminderRules();
    const rule = rules.find((item) => item.id === occurrence.ruleId);
    occurrence.arrangementsNotes = arrangementsNotes;

    const channel = await interaction.client.channels.fetch(CHANNELS.CALENDAR_TALK);
    if (channel && channel.isTextBased() && occurrence.promptMessageId) {
      try {
        const message = await (channel as any).messages.fetch(occurrence.promptMessageId);
        await message.edit({
          components: buildConfirmedComponents(occurrence, rule).components,
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (err) {
        console.error("Failed to edit reminder message:", err);
      }
    }

    const payload = buildReminderPromptUpdate("Arrangements saved.");
    await safeReply(interaction, {
      components: payload.components,
      flags: buildComponentsV2Flags(true),
    });
  }
}
