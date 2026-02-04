import { query } from "../lib/db/oracle.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { getOAuth2Client } from "../lib/google/auth.js";

export interface IGoogleAuthData {
  discordUserId: string;
  googleUserId?: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null; // Timestamp
}

export const saveUserTokens = async (
  discordUserId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }
) => {
  if (!tokens.access_token) {
      throw new Error("No access token provided to save.");
  }
  
  // We need to merge with existing tokens because refresh_token might not be sent on subsequent updates
  // But for the first insert, we need both.
  // Actually, let's just do a MERGE (Upsert) logic.
  
  // Encrypt tokens
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

  // Oracle MERGE statement to handle Insert or Update
  // Note: Oracle doesn't support "ON CONFLICT" like Postgres, uses MERGE INTO
  
  // If we don't have a new refresh token, we should probably keep the old one?
  // For simplicity, let's fetch existing first if refresh token is missing.
  
  const refreshTokenToSave = encryptedRefreshToken;
  
  if (!refreshTokenToSave) {
      // Try to fetch existing to preserve it
      const existing = await getUserTokens(discordUserId);
      if (existing) {
          // Re-encrypting the decrypted value isn't efficient, but we store encrypted.
          // Accessing raw db value would be better, but this abstract is fine for now.
          // Actually, we can just NOT update the refresh_token column if it's null.
      }
  }

  let sql = "";
  const params: any = {
      dId: discordUserId,
      accTok: encryptedAccessToken,
      exp: tokens.expiry_date ? new Date(tokens.expiry_date) : null
  };

  if (refreshTokenToSave) {
      params.refTok = refreshTokenToSave;
      sql = `
        MERGE INTO CALENDAR_GOOGLE_AUTH target
        USING (SELECT :dId AS DISCORD_USER_ID, :accTok AS ACCESS_TOKEN, :refTok AS REFRESH_TOKEN, :exp AS EXPIRY_DATE FROM DUAL) source
        ON (target.DISCORD_USER_ID = source.DISCORD_USER_ID)
        WHEN MATCHED THEN
            UPDATE SET target.ACCESS_TOKEN = source.ACCESS_TOKEN, target.REFRESH_TOKEN = source.REFRESH_TOKEN, target.EXPIRY_DATE = source.EXPIRY_DATE, target.UPDATED_AT = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (DISCORD_USER_ID, ACCESS_TOKEN, REFRESH_TOKEN, EXPIRY_DATE)
            VALUES (source.DISCORD_USER_ID, source.ACCESS_TOKEN, source.REFRESH_TOKEN, source.EXPIRY_DATE)
      `;
  } else {
      // Don't touch refresh token
       sql = `
        MERGE INTO CALENDAR_GOOGLE_AUTH target
        USING (SELECT :dId AS DISCORD_USER_ID, :accTok AS ACCESS_TOKEN, :exp AS EXPIRY_DATE FROM DUAL) source
        ON (target.DISCORD_USER_ID = source.DISCORD_USER_ID)
        WHEN MATCHED THEN
            UPDATE SET target.ACCESS_TOKEN = source.ACCESS_TOKEN, target.EXPIRY_DATE = source.EXPIRY_DATE, target.UPDATED_AT = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (DISCORD_USER_ID, ACCESS_TOKEN, EXPIRY_DATE)
            VALUES (source.DISCORD_USER_ID, source.ACCESS_TOKEN, source.EXPIRY_DATE)
      `;
  }

  await query(sql, params);
};

export const getUserTokens = async (discordUserId: string): Promise<IGoogleAuthData | null> => {
    const sql = `SELECT * FROM CALENDAR_GOOGLE_AUTH WHERE DISCORD_USER_ID = :dId`;
    const rows = await query<any>(sql, { dId: discordUserId });

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
        discordUserId: row.DISCORD_USER_ID,
        googleUserId: row.GOOGLE_USER_ID,
        accessToken: row.ACCESS_TOKEN ? decrypt(row.ACCESS_TOKEN) : "",
        refreshToken: row.REFRESH_TOKEN ? decrypt(row.REFRESH_TOKEN) : "",
        expiryDate: row.EXPIRY_DATE ? new Date(row.EXPIRY_DATE).getTime() : null
    };
};

export const deleteUserTokens = async (discordUserId: string) => {
    await query(`DELETE FROM CALENDAR_GOOGLE_AUTH WHERE DISCORD_USER_ID = :dId`, { dId: discordUserId });
};

export const getAuthenticatedClient = async (discordUserId: string) => {
  const tokens = await getUserTokens(discordUserId);
  if (!tokens) {
    throw new Error("User is not connected to Google Calendar.");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiryDate,
  });

  oauth2Client.on("tokens", async (newTokens) => {
    // console.log(`Refreshing tokens for user ${discordUserId}`);
    await saveUserTokens(discordUserId, newTokens);
  });

  return oauth2Client;
};
