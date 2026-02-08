import { ApplicationCommandOptionType, CommandInteraction, Role } from "discord.js";
import { Client, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  addReminderRule,
  buildRuleAddedComponents,
  buildRuleErrorComponents,
  buildRuleRemovedComponents,
  buildRulesListComponents,
  listReminderRules,
  normalizeReminderKeyword,
  removeReminderRule,
  processReminders,
} from "../services/reminderService.js";
import { buildComponentsV2Flags, safeDeferReply, safeReply } from "../lib/discord/interactionUtils.js";
import { forceUpdateAllTodayMessages } from "../services/todayService.js";
import { forceUpdateAllWeekMessages } from "../services/weekService.js";

const refreshReminderViews = async (client: Client): Promise<void> => {
  try {
    await processReminders(client);
    await forceUpdateAllTodayMessages(client);
    await forceUpdateAllWeekMessages(client);
  } catch (err: any) {
    console.error("Failed to refresh reminder views:", err);
  }
};

@Discord()
@SlashGroup({ description: "Admin commands", name: "admin" })
@SlashGroup("admin")
@SlashGroup({ description: "Manage reminder rules", name: "reminder", root: "admin" })
export class AdminReminderCommand {
  @SlashGroup("reminder", "admin")
  @Slash({ description: "Add a reminder keyword rule" })
  async add(
    @SlashOption({
      description: "Keyword or phrase to match in event titles",
      name: "keyword",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    keyword: string,
    @SlashOption({
      description: "Days before the event to alert",
      name: "reminder_days",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    reminderDays: number,
    @SlashOption({
      description: "Whether arrangements are required",
      name: "arrangements_required",
      required: true,
      type: ApplicationCommandOptionType.Boolean,
    })
    arrangementsRequired: boolean,
    @SlashOption({
      description: "First role to ping",
      name: "role_1",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    role1: Role | undefined,
    @SlashOption({
      description: "Second role to ping",
      name: "role_2",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    role2: Role | undefined,
    @SlashOption({
      description: "Third role to ping",
      name: "role_3",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    role3: Role | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const normalized = normalizeReminderKeyword(keyword);
    if (!normalized) {
      const payload = buildRuleErrorComponents("Keyword cannot be empty.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (reminderDays < 0) {
      const payload = buildRuleErrorComponents("Reminder days must be 0 or higher.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const roleIds = [role1?.id, role2?.id, role3?.id].filter(
      (value): value is string => Boolean(value),
    );

    try {
      await addReminderRule(
        interaction.user.id,
        normalized,
        reminderDays,
        roleIds,
        arrangementsRequired,
      );
      const payload = buildRuleAddedComponents(normalized);
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      void refreshReminderViews(interaction.client as Client);
    } catch (err: any) {
      console.error("Failed to add reminder rule:", err);
      const payload = buildRuleErrorComponents("Failed to add rule.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @SlashGroup("reminder", "admin")
  @Slash({ description: "List reminder rules" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    try {
      const rules = await listReminderRules();
      const payload = buildRulesListComponents(rules);
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (err: any) {
      console.error("Failed to list reminder rules:", err);
      const payload = buildRuleErrorComponents("Failed to list rules.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @SlashGroup("reminder", "admin")
  @Slash({ description: "Remove a reminder rule by ID" })
  async remove(
    @SlashOption({
      description: "Rule ID to remove",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    id: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    try {
      await removeReminderRule(id);
      const payload = buildRuleRemovedComponents(id);
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
      void refreshReminderViews(interaction.client as Client);
    } catch (err: any) {
      console.error("Failed to remove reminder rule:", err);
      const payload = buildRuleErrorComponents("Failed to remove rule.");
      await safeReply(interaction, {
        components: payload.components,
        flags: buildComponentsV2Flags(true),
      });
    }
  }
}
