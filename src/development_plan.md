# Google Calendar Integration Plan

## Goal
Connect the Discord bot to a user's Google account to read and update the user's calendars,
including calendars shared with them.

## OAuth + Google Cloud Setup
- Create a Google Cloud project and enable the Google Calendar API.
- Create OAuth2 client credentials (web application).
- Configure redirect URIs for local dev and production callback endpoints.
- Define least-privilege scopes, with an opt-in path to upgrade permissions for write access.

## Discord Command Flow
- `/connect` returns an OAuth link and uses a `state` token tied to the Discord user.
- OAuth callback exchanges code for tokens and confirms link success to the user.
- Keep required options before optional options in all slash commands.
- Use `flags: MessageFlags.Ephemeral` for private responses.

## Data Model (Tables Prefixed with CALENDAR_)
- `CALENDAR_GoogleAuth`: store `discordUserId`, `googleUserId`, encrypted tokens, and expiry.
- `CALENDAR_UserCalendars`: map users to selected calendar IDs for sync.
- `CALENDAR_CalendarSync`: store per-calendar `syncToken` for incremental sync.
- `CALENDAR_WatchChannels`: store webhook channel IDs and expiration for push updates.

## Calendar Discovery
- Use `calendarList.list` to fetch all calendars available to the user, including shared.
- Allow users to choose which calendars to sync via a `/calendars choose` command.

## Event Sync Strategy
- Use `events.list` with `syncToken` per calendar for incremental updates.
- Refresh and store new `syncToken` after each sync.
- Backoff/retry on `429` and `503` with exponential delay.

## Optional Push Updates
- Register webhooks via `events.watch` per calendar.
- Track channel expiration and renew before expiration.

## Helpers and Centralization
- Centralize Google client creation to inject tokens, scopes, and retry behavior.
- Keep TypeScript types strict and avoid unused imports/variables.

## Security Notes
- Encrypt refresh/access tokens at rest.
- Minimize scopes and require explicit user action for write permissions.
