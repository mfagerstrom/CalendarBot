import { Client } from "discordx";
import { Message } from "discord.js";
import { CHANNELS } from "../config/channels.js";

const RESTRICTED_CHANNEL_IDS = new Set<string>([
    CHANNELS.TODAY,
    CHANNELS.THIS_WEEK,
]);

const NO_CHAT_DM_REMINDER = [
    "Your message was removed because that channel is read-only.",
    "Please use the calendar chat channel for discussion instead.",
].join(" ");

const buildForwardedMessage = (message: Message): string => {
    const header = `Moved message from <#${message.channelId}> by <@${message.author.id}>:`;
    const content = message.content.trim().length > 0 ? message.content : "_(no text content)_";
    const attachmentUrls = message.attachments.map((attachment) => attachment.url);

    if (attachmentUrls.length === 0) {
        return `${header}\n${content}`;
    }

    return `${header}\n${content}\n${attachmentUrls.join("\n")}`;
};

const handleRestrictedChannelMessage = async (
    client: Client,
    message: Message,
): Promise<void> => {
    if (message.author.bot) {
        return;
    }

    if (!message.guildId || !RESTRICTED_CHANNEL_IDS.has(message.channelId)) {
        return;
    }

    const forwardedContent = buildForwardedMessage(message);

    try {
        await message.delete();
    } catch (err) {
        console.warn("Failed to delete restricted-channel message:", err);
        return;
    }

    try {
        await message.author.send(NO_CHAT_DM_REMINDER);
    } catch (err) {
        console.warn(`Failed to DM user ${message.author.id} after deletion:`, err);
    }

    try {
        const calendarChatChannel = await client.channels.fetch(CHANNELS.CALENDAR_CHAT);
        if (!calendarChatChannel || !calendarChatChannel.isTextBased()) {
            return;
        }

        await (calendarChatChannel as any).send({
            content: forwardedContent,
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        console.error("Failed to forward deleted message to calendar chat channel:", err);
    }
};

export const installChannelModerationService = (client: Client): void => {
    client.on("messageCreate", async (message: Message) => {
        await handleRestrictedChannelMessage(client, message);
    });
};
