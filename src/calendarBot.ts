import "reflect-metadata";
import "dotenv/config";
import { dirname, importx } from "@discordx/importer";
import { Client } from "discordx";
import { GatewayIntentBits } from "discord.js";
import express from "express";

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
  // For now, we print it.
  console.log(`Received code for state (userId): ${state}`);

  try {
    // In a real implementation, we would exchange the code here.
    // const { tokens } = await oauth2Client.getToken(code);
    // oauth2Client.setCredentials(tokens);
    // Save tokens to DB for the user identified by 'state'

    res.send("Authentication successful! You can now close this window and return to Discord.");
  } catch (error) {
    console.error("Error during authentication", error);
    res.status(500).send("Authentication failed.");
  }
});


const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  await client.initApplicationCommands();
  console.log(`Logged in as ${client.user?.tag ?? "unknown user"}`);
});

const start = async () => {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is not set.");
  }

  // Load commands
  const _dirname = dirname(import.meta.url);
  await importx(`${_dirname}/commands/**/*.{ts,js}`);

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
