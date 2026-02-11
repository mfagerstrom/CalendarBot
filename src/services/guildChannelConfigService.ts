import type { Client } from "discordx";
import { CHANNELS } from "../config/channels.js";
import { query } from "../lib/db/oracle.js";

export type GuildChannelKey = keyof typeof CHANNELS;

type IGuildChannelRow = {
  GUILD_ID: string;
  CHANNEL_KEY: string;
  CHANNEL_ID: string;
};

const CHANNEL_KEYS = Object.keys(CHANNELS) as GuildChannelKey[];

export const listGuildChannelKeys = (): GuildChannelKey[] => {
  return [...CHANNEL_KEYS];
};

export const isGuildChannelKey = (value: string): value is GuildChannelKey => {
  return CHANNEL_KEYS.includes(value as GuildChannelKey);
};

export const getDefaultChannelId = (key: GuildChannelKey): string => {
  return CHANNELS[key];
};

export const setGuildChannelConfig = async (
  guildId: string,
  key: GuildChannelKey,
  channelId: string,
): Promise<void> => {
  await query(
    `
      MERGE INTO CALENDAR_GuildChannelConfig target
      USING (
        SELECT :guildId AS GUILD_ID, :channelKey AS CHANNEL_KEY, :channelId AS CHANNEL_ID
        FROM DUAL
      ) source
      ON (target.GUILD_ID = source.GUILD_ID AND target.CHANNEL_KEY = source.CHANNEL_KEY)
      WHEN MATCHED THEN
        UPDATE SET target.CHANNEL_ID = source.CHANNEL_ID, target.UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (GUILD_ID, CHANNEL_KEY, CHANNEL_ID, CREATED_AT, UPDATED_AT)
        VALUES (source.GUILD_ID, source.CHANNEL_KEY, source.CHANNEL_ID, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    {
      guildId,
      channelKey: key,
      channelId,
    },
  );
};

export const clearGuildChannelConfig = async (
  guildId: string,
  key: GuildChannelKey,
): Promise<void> => {
  await query(
    `
      DELETE FROM CALENDAR_GuildChannelConfig
      WHERE GUILD_ID = :guildId
        AND CHANNEL_KEY = :channelKey
    `,
    {
      guildId,
      channelKey: key,
    },
  );
};

export const listGuildChannelOverrides = async (
  guildId: string,
): Promise<Partial<Record<GuildChannelKey, string>>> => {
  const rows = await query<IGuildChannelRow>(
    `
      SELECT GUILD_ID, CHANNEL_KEY, CHANNEL_ID
      FROM CALENDAR_GuildChannelConfig
      WHERE GUILD_ID = :guildId
    `,
    { guildId },
  );

  const output: Partial<Record<GuildChannelKey, string>> = {};
  for (const row of rows) {
    const key = String(row.CHANNEL_KEY ?? "");
    if (!isGuildChannelKey(key)) {
      continue;
    }
    output[key] = String(row.CHANNEL_ID ?? "");
  }

  return output;
};

export const getGuildChannelId = async (
  guildId: string,
  key: GuildChannelKey,
): Promise<string> => {
  const rows = await query<IGuildChannelRow>(
    `
      SELECT CHANNEL_ID
      FROM CALENDAR_GuildChannelConfig
      WHERE GUILD_ID = :guildId
        AND CHANNEL_KEY = :channelKey
    `,
    {
      guildId,
      channelKey: key,
    },
  );

  if (rows.length > 0) {
    const id = String(rows[0].CHANNEL_ID ?? "");
    if (id) return id;
  }

  return getDefaultChannelId(key);
};

export const listEffectiveGuildChannels = async (
  guildId: string,
): Promise<Record<GuildChannelKey, string>> => {
  const overrides = await listGuildChannelOverrides(guildId);
  const output = {} as Record<GuildChannelKey, string>;
  for (const key of CHANNEL_KEYS) {
    output[key] = overrides[key] || getDefaultChannelId(key);
  }
  return output;
};

const listOverrideGuildIds = async (): Promise<string[]> => {
  const rows = await query<{ GUILD_ID: string }>(
    `
      SELECT DISTINCT GUILD_ID
      FROM CALENDAR_GuildChannelConfig
      ORDER BY GUILD_ID ASC
    `,
  );
  return rows.map((row) => String(row.GUILD_ID ?? "")).filter(Boolean);
};

export const listKnownGuildIds = async (client: Client): Promise<string[]> => {
  const cacheIds = client.guilds.cache.map((guild) => guild.id);
  if (cacheIds.length === 0) {
    try {
      const fetched = await client.guilds.fetch();
      fetched.forEach((guild) => cacheIds.push(guild.id));
    } catch {
      // Ignore fetch issues and rely on cache plus DB overrides.
    }
  }

  const overrideIds = await listOverrideGuildIds();
  return Array.from(new Set([...cacheIds, ...overrideIds])).filter(Boolean);
};

