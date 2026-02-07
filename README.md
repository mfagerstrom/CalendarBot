# CalendarBot

CalendarBot is a private Discord bot for my family of six to coordinate calendars. It aggregates events from 12 Google Calendars and keeps static posts in dedicated Discord channels up to date so everyone has a single place to check what is happening today and this week.

## What It Does
- Connects each family member's Google Calendar via OAuth
- Syncs calendar changes on a 5 minute loop
- Updates static Discord posts in the Today and This Week channels whenever events change or the day rolls over
- Uses Discord Components v2 for all bot output

## User Commands
- `/today` List all events occurring today across your selected calendars
- `/todo` List and manage GitHub issues for the project

## Setup
1. Create a Discord application and add the bot to your guild.
2. Configure Google OAuth credentials and an OAuth redirect URL.
3. Provision an Oracle database and run the SQL scripts in `db/`.
4. Create a `.env` file with the following values:

```env
DISCORD_TOKEN=
GUILD_ID=
PORT=3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
ORACLE_USER=
ORACLE_PASSWORD=
ORACLE_CONNECT_STRING=
ENCRYPTION_KEY=
GITHUB_REPO_OWNER=
GITHUB_REPO_NAME=
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY=
```

## Development
```bash
npm run dev
```

## Build and Run
```bash
npm run build
npm run start
```

## Scripts
- `npm run lint` ESLint
- `npm run compile` TypeScript typecheck
- `npm run watch` Development watcher
- `npm run buildProd` Compile and restart via pm2

## Database
Schema docs and SQL setup scripts live in `db/`.
