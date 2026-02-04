import { EmbedBuilder, TextChannel } from "discord.js";
import { CHANNELS } from "../../config/channels.js";
import { Client } from "discordx";

const MAX_DESCRIPTION_LENGTH = 3900;
const LEVEL_COLORS: Record<string, number> = {
  log: 0x95a5a6,
  info: 0x3498db,
  warn: 0xf39c12,
  error: 0xe74c3c,
  debug: 0x9b59b6,
};

type ConsoleLevel = "log" | "error" | "warn" | "info" | "debug";

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: (console as any).debug ? (console as any).debug.bind(console) : console.log.bind(console),
};

let discordClient: Client | null = null;
let logChannel: TextChannel | null = null;
let resolvingChannel = false;
let logBuffer: { time: number, message: string }[] = [];
let logBufferTimer: NodeJS.Timeout | null = null;
const LOG_BATCH_INTERVAL = 15 * 1000;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

async function ensureChannel(): Promise<TextChannel | null> {
  if (!discordClient) return null;
  if (logChannel) return logChannel;
  if (resolvingChannel) return logChannel;

  resolvingChannel = true;
  try {
    const channel = await discordClient.channels.fetch(CHANNELS.BOT_LOGS).catch(() => null);
    if (channel && channel.isTextBased()) {
      logChannel = channel as TextChannel;
    }
  } finally {
    resolvingChannel = false;
  }

  return logChannel;
}

async function flushLogBuffer() {
  if (logBuffer.length === 0) return;

  // Sort by time ascending
  const logsToSend = [...logBuffer].sort((a, b) => a.time - b.time);
  logBuffer = [];

  const channel = await ensureChannel();
  if (!channel) {
    // If we can't get the channel, we drop the logs to avoid memory leaks
    // or we could put them back? For now, drop implies safety.
    return;
  }

  try {
    // Chunk messages
    let currentDescription = "";
    const embeds = [];

    for (const item of logsToSend) {
        // const timestamp = new Date(item.time).toLocaleTimeString("en-US", { hour12: false });
        // const line = `${timestamp} ${item.message}`;
        const line = item.message;
        
        // Account for code block wrapper ```\n ... \n``` (approx 8 chars)
        if (currentDescription.length + line.length + 1 > MAX_DESCRIPTION_LENGTH - 8) {
            embeds.push(new EmbedBuilder()
                .setDescription(`\`\`\`\n${currentDescription}\`\`\``)
                .setColor(LEVEL_COLORS.log)
                .setTimestamp(new Date()));
            currentDescription = "";
        }
        currentDescription += line + "\n";
    }

    if (currentDescription.length > 0) {
        embeds.push(new EmbedBuilder()
            .setDescription(`\`\`\`\n${currentDescription}\`\`\``)
            .setColor(LEVEL_COLORS.log)
            .setTimestamp(new Date()));
    }

    for (const embed of embeds) {
        await channel.send({ embeds: [embed] });
    }
  } catch {
      // Swallow
  }
}

async function sendToDiscord(level: ConsoleLevel, message: string): Promise<void> {
  try {
    if (level === "log") {
        logBuffer.push({ time: Date.now(), message });
        
        if (!logBufferTimer) {
            logBufferTimer = setInterval(() => void flushLogBuffer(), LOG_BATCH_INTERVAL);
        }
        return;
    }

    // Filter out noisy Discord client acknowledgement errors
    if (
      level === "error" &&
      message.includes("Discord client error:") &&
      (message.includes("DiscordAPIError[40060]") || message.includes("DiscordAPIError[10062]"))
    ) {
      return;
    }

    const channel = await ensureChannel();
    if (!channel) return;

    const prefix = `[${level.toUpperCase()}] `;
    const text = prefix + message;
    const shouldWrapInCodeBlock = level === "error" || level === "warn";
    const maxTextLength = shouldWrapInCodeBlock ? MAX_DESCRIPTION_LENGTH - 8 : MAX_DESCRIPTION_LENGTH;
    const trimmed =
      text.length > maxTextLength ? text.slice(0, maxTextLength - 3) + "..." : text;
    const description = shouldWrapInCodeBlock ? `\`\`\`\n${trimmed}\n\`\`\`` : trimmed;
    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor(LEVEL_COLORS[level] ?? LEVEL_COLORS.log)
      .setTimestamp(new Date());

    await channel.send({ embeds: [embed] });
  } catch {
    // Swallow to avoid recursive console logging on failures
  }
}

export function installConsoleLogging(): void {
  const levels: ConsoleLevel[] = ["log", "error", "warn", "info", "debug"];

  for (const level of levels) {
    (console as any)[level] = (...args: unknown[]) => {
      const msg = formatArgs(args);
      (originalConsole as any)[level](...args);
      // Fire and forget to avoid awaiting in sync console calls
      void sendToDiscord(level, msg);
    };
  }
}

export function setConsoleLoggingClient(client: Client): void {
  discordClient = client;
}

export async function logToDiscord(message: string, level: ConsoleLevel = "log"): Promise<void> {
  const msg = formatArgs([message]);
  await sendToDiscord(level, msg);
}
