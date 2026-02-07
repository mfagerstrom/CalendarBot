import {
  CommandInteraction,
  InteractionDeferReplyOptions,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageFlags,
  RepliableInteraction,
} from "discord.js";

export type AnyRepliable = RepliableInteraction | CommandInteraction;

const ACK_CODES = new Set([40060, 10062]);

const isAckError = (err: any): boolean => {
  const code = err?.code ?? err?.rawError?.code;
  return ACK_CODES.has(code);
};

export const buildComponentsV2Flags = (isEphemeral: boolean): number => {
  return MessageFlags.IsComponentsV2 | (isEphemeral ? MessageFlags.Ephemeral : 0);
};

export const safeDeferReply = async (
  interaction: AnyRepliable,
  options?: InteractionDeferReplyOptions,
): Promise<void> => {
  const anyInteraction = interaction as any;
  if (anyInteraction.deferred || anyInteraction.replied || anyInteraction.__calendarAcked) {
    return;
  }

  try {
    await anyInteraction.deferReply(options as any);
    anyInteraction.__calendarAcked = true;
    anyInteraction.__calendarDeferred = true;
  } catch (err: any) {
    if (!isAckError(err)) throw err;
  }
};

export const safeReply = async (
  interaction: AnyRepliable,
  options: InteractionReplyOptions,
): Promise<any> => {
  const anyInteraction = interaction as any;
  const deferred = Boolean(
    anyInteraction.__calendarDeferred !== undefined
      ? anyInteraction.__calendarDeferred
      : anyInteraction.deferred,
  );
  const replied = Boolean(anyInteraction.replied);
  const acked = Boolean(anyInteraction.__calendarAcked ?? deferred ?? replied);

  if (deferred && !replied) {
    try {
      return await interaction.editReply(options as any);
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  if (replied || acked) {
    try {
      return await interaction.followUp(options as any);
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  try {
    const result = await interaction.reply(options as any);
    anyInteraction.__calendarAcked = true;
    return result;
  } catch (err: any) {
    if (!isAckError(err)) throw err;
  }
};

export const safeUpdate = async (
  interaction: AnyRepliable,
  options: InteractionUpdateOptions,
): Promise<void> => {
  const anyInteraction = interaction as any;
  if (typeof anyInteraction.update === "function") {
    try {
      await anyInteraction.update(options as any);
      anyInteraction.__calendarAcked = true;
      anyInteraction.__calendarDeferred = false;
      return;
    } catch (err: any) {
      if (!isAckError(err)) {
        // fall through to follow-up
      } else {
        return;
      }
    }
  }

  const baseFlags = Number(options.flags ?? 0);
  const fallbackFlags = baseFlags | MessageFlags.Ephemeral;
  const replyOptions: InteractionReplyOptions = { ...options, flags: fallbackFlags } as any;
  if (replyOptions.content === null) {
    delete (replyOptions as any).content;
  }
  await safeReply(interaction, replyOptions);
};
