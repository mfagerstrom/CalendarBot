import "reflect-metadata";
import "dotenv/config";
import { dirname, importx } from "@discordx/importer";
import { Client } from "discordx";
import { GatewayIntentBits, Interaction } from "discord.js";
import express from "express";
import { initDB } from "./lib/db/oracle.js";
import { getOAuth2Client } from "./lib/google/auth.js";
import { saveUserTokens } from "./services/googleAuthService.js";
import { installConsoleLogging, setConsoleLoggingClient } from "./lib/discord/consoleLogger.js";
import { startCalendarSyncService } from "./services/schedulerService.js";

// Initialize console logging
installConsoleLogging();

// Web server for OAuth callback
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code) {
    res.status(400).send("No code provided.");
    return;
  }

  // TODO: Validate 'state' matches a pending user request (CSRF protection) and get the userId.
  // For now, using state as userId
  const discordUserId = state;
  console.log(`Received code for discordUserId: ${discordUserId}`);

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens to DB
    await saveUserTokens(discordUserId, tokens);
    console.log(`Tokens saved for user ${discordUserId}`);

    res.send("Authentication successful! You have connected your Google Calendar to CalendarBot. You can close this window.");
  } catch (error) {
    console.error("Error during authentication", error);
    res.status(500).send("Authentication failed. Check bot logs for details.");
  }
});


export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  botGuilds: process.env.GUILD_ID ? [process.env.GUILD_ID] : undefined,
  silent: false, // Enable debug logging for discordx
});

client.once("ready", async () => {
  // Clear global commands to avoid duplicates
  await client.clearApplicationCommands();
  await client.initApplicationCommands();
  
  // Set the client for the logger so it can start sending to Discord
  setConsoleLoggingClient(client);
  
  console.log(`Logged in as ${client.user?.tag ?? "unknown user"}`);
});

client.on("interactionCreate", (interaction: Interaction) => {
  client.executeInteraction(interaction);
});

const start = async () => {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is not set.");
  }

  // Load commands
  const _dirname = dirname(import.meta.url);
  await importx(`${_dirname}/commands/**/*.{ts,js}`);

  // Initialize DB
  await initDB();

  // Start Sync Service
  startCalendarSyncService(client);

  // Start Web Server
  app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
  });

  await client.login(token);
};

start().catch((error) => {
  console.error("Failed to start CalendarBot:", error);
  process.exitCode = 1;
});
