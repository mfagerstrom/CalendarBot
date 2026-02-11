import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent, SelectMenuComponent } from "discordx";
import {
  buildConfirmedComponents,
  buildPromptComponents,
  buildSnoozedResponse,
  buildReminderPromptUpdate,
  completeOccurrenceWithArrangements,
  getOccurrenceById,
  getReminderRules,
  parseReminderId,
  REMINDER_ACK_REGEX,
  REMINDER_NOTES_REGEX,
  REMINDER_ARRANGEMENTS_REGEX,
  REMINDER_SNOOZE_REGEX,
  snoozeOccurrence,
  updateOccurrenceArrangementsNotes,
} from "../services/reminderService.js";
import {
  buildComponentsV2Flags,
  safeDeferReply,
  safeReply,
  safeUpdate,
} from "../lib/discord/interactionUtils.js";
import { getGuildChannelId } from "../services/guildChannelConfigService.js";
import {
  ARRANGEMENT_QUEUE_COMPLETE_MODAL_REGEX,
  ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID,
  ARRANGEMENT_QUEUE_NOTES_MODAL_REGEX,
  ARRANGEMENT_QUEUE_NOTES_SELECT_ID,
  ensureArrangementQueueMessage,
} from "../services/arrangementQueueService.js";

@Discord()
export class ReminderInteractions {
  private parseQueueId(customId: string, prefix: string): number | null {
    const parts = customId.split(":");
    if (parts.length !== 2 || parts[0] !== prefix) return null;
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return null;
    return id;
  }

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
            .setRequired(true)
            .setValue(occurrence.arrangementsNotes ?? ""),
        ),
      );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: REMINDER_NOTES_REGEX })
  async addNotes(interaction: ButtonInteraction): Promise<void> {
    const occurrenceId = parseReminderId(interaction.customId, "reminder-notes");
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
      .setCustomId(`reminder-notes:${occurrenceId}`)
      .setTitle("Arrangements Notes")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("arrangements-notes")
            .setLabel("Notes about arrangements")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(occurrence.arrangementsNotes ?? ""),
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

  @ModalComponent({ id: REMINDER_NOTES_REGEX })
  async submitNotes(interaction: any): Promise<void> {
    const occurrenceId = parseReminderId(interaction.customId, "reminder-notes");
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
    await updateOccurrenceArrangementsNotes(occurrenceId, arrangementsNotes);

    const rules = await getReminderRules();
    const rule = rules.find((item) => item.id === occurrence.ruleId);
    occurrence.arrangementsNotes = arrangementsNotes;

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }
    const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");
    const channel = await interaction.client.channels.fetch(reminderChannelId);
    if (channel && channel.isTextBased() && occurrence.promptMessageId) {
      try {
        const message = await (channel as any).messages.fetch(occurrence.promptMessageId);
        await message.edit({
          components: buildPromptComponents(occurrence, rule).components,
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (err) {
        console.error("Failed to edit reminder message:", err);
      }
    }

    const arrangementChannelId = await getGuildChannelId(guildId, "ARRANGEMENTS_QUEUE");
    await ensureArrangementQueueMessage(interaction.client as any, arrangementChannelId);

    const payload = buildReminderPromptUpdate("Arrangements notes saved.");
    await safeReply(interaction, {
      components: payload.components,
      flags: buildComponentsV2Flags(true),
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

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }
    const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");
    const channel = await interaction.client.channels.fetch(reminderChannelId);
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

    const arrangementChannelId = await getGuildChannelId(guildId, "ARRANGEMENTS_QUEUE");
    await ensureArrangementQueueMessage(interaction.client as any, arrangementChannelId);

    const payload = buildReminderPromptUpdate("Arrangements saved.");
    await safeReply(interaction, {
      components: payload.components,
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID })
  async handleArrangementQueueCompleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const occurrenceId = Number(interaction.values[0]);
    if (!Number.isFinite(occurrenceId)) {
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

    const modal = new ModalBuilder()
      .setCustomId(`${ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID}:${occurrenceId}`)
      .setTitle("Arrangements Made")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("arrangements-notes")
            .setLabel("What arrangements were made?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(occurrence.arrangementsNotes ?? ""),
        ),
      );

    await interaction.showModal(modal);
  }

  @SelectMenuComponent({ id: ARRANGEMENT_QUEUE_NOTES_SELECT_ID })
  async handleArrangementQueueNotesSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const occurrenceId = Number(interaction.values[0]);
    if (!Number.isFinite(occurrenceId)) {
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

    const modal = new ModalBuilder()
      .setCustomId(`${ARRANGEMENT_QUEUE_NOTES_SELECT_ID}:${occurrenceId}`)
      .setTitle("Arrangements Notes")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("arrangements-notes")
            .setLabel("Notes about arrangements")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(occurrence.arrangementsNotes ?? ""),
        ),
      );

    await interaction.showModal(modal);
  }

  @ModalComponent({ id: ARRANGEMENT_QUEUE_COMPLETE_MODAL_REGEX })
  async submitArrangementQueueComplete(interaction: any): Promise<void> {
    const occurrenceId = this.parseQueueId(
      interaction.customId,
      ARRANGEMENT_QUEUE_COMPLETE_SELECT_ID,
    );
    if (!occurrenceId) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
      if (typeof interaction.deleteReply === "function") {
        await interaction.deleteReply();
      }
      return;
    }

    const occurrence = await getOccurrenceById(occurrenceId);
    if (!occurrence) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
      if (typeof interaction.deleteReply === "function") {
        await interaction.deleteReply();
      }
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    const rawNotes = interaction.fields.getTextInputValue("arrangements-notes");
    const arrangementsNotes = rawNotes.replace(/\s+/g, " ").trim();
    await completeOccurrenceWithArrangements(occurrenceId, arrangementsNotes);
    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }
    const arrangementChannelId = await getGuildChannelId(guildId, "ARRANGEMENTS_QUEUE");
    await ensureArrangementQueueMessage(interaction.client as any, arrangementChannelId);

    const rules = await getReminderRules();
    const rule = rules.find((item) => item.id === occurrence.ruleId);
    occurrence.arrangementsNotes = arrangementsNotes;

    const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");
    const channel = await interaction.client.channels.fetch(reminderChannelId);
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

    if (typeof interaction.deleteReply === "function") {
      await interaction.deleteReply();
    }
  }

  @ModalComponent({ id: ARRANGEMENT_QUEUE_NOTES_MODAL_REGEX })
  async submitArrangementQueueNotes(interaction: any): Promise<void> {
    const occurrenceId = this.parseQueueId(
      interaction.customId,
      ARRANGEMENT_QUEUE_NOTES_SELECT_ID,
    );
    if (!occurrenceId) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
      if (typeof interaction.deleteReply === "function") {
        await interaction.deleteReply();
      }
      return;
    }

    const occurrence = await getOccurrenceById(occurrenceId);
    if (!occurrence) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
      if (typeof interaction.deleteReply === "function") {
        await interaction.deleteReply();
      }
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    const rawNotes = interaction.fields.getTextInputValue("arrangements-notes");
    const arrangementsNotes = rawNotes.replace(/\s+/g, " ").trim();
    await updateOccurrenceArrangementsNotes(occurrenceId, arrangementsNotes);
    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }
    const arrangementChannelId = await getGuildChannelId(guildId, "ARRANGEMENTS_QUEUE");
    await ensureArrangementQueueMessage(interaction.client as any, arrangementChannelId);

    const rules = await getReminderRules();
    const rule = rules.find((item) => item.id === occurrence.ruleId);
    occurrence.arrangementsNotes = arrangementsNotes;

    const reminderChannelId = await getGuildChannelId(guildId, "CALENDAR_REMINDERS");
    const channel = await interaction.client.channels.fetch(reminderChannelId);
    if (channel && channel.isTextBased() && occurrence.promptMessageId) {
      try {
        const message = await (channel as any).messages.fetch(occurrence.promptMessageId);
        await message.edit({
          components: buildPromptComponents(occurrence, rule).components,
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (err) {
        console.error("Failed to edit reminder message:", err);
      }
    }

    if (typeof interaction.deleteReply === "function") {
      await interaction.deleteReply();
    }
  }
}
