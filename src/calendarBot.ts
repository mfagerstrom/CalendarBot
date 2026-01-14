import "reflect-metadata";
import "dotenv/config";
import { Client } from "discordx";
import { GatewayIntentBits } from "discord.js";

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

  await client.login(token);
};

start().catch((error) => {
  console.error("Failed to start CalendarBot:", error);
  process.exitCode = 1;
});
