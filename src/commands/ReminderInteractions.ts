import { ButtonInteraction } from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import {
  buildConfirmedComponents,
  buildSnoozedResponse,
  buildReminderPromptUpdate,
  completeOccurrence,
  getOccurrenceById,
  getReminderRules,
  parseReminderId,
  REMINDER_ACK_REGEX,
  REMINDER_SNOOZE_REGEX,
  snoozeOccurrence,
} from "../services/reminderService.js";
import { buildComponentsV2Flags, safeUpdate } from "../lib/discord/interactionUtils.js";

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

    await completeOccurrence(occurrenceId);

    const rules = await getReminderRules();
    const rule = rules.find((item) => item.id === occurrence.ruleId);

    await safeUpdate(interaction, {
      components: buildConfirmedComponents(occurrence, rule).components,
      flags: buildComponentsV2Flags(false),
    });
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
}
