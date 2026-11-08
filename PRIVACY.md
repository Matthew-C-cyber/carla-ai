# Carla AI Privacy Policy

_Effective: November 5, 2026_

Carla AI ("Carla") is an open-source Discord bot that lets you manage your own Google Tasks and Google Calendar from Discord. This policy explains what Carla accesses, what it stores, and how to delete it.

## What Carla accesses

When you run `/google connect` and approve access, Carla can:

- **Google Tasks** (`https://www.googleapis.com/auth/tasks`): read, create, update and delete tasks in your default task list.
- **Google Calendar events** (`https://www.googleapis.com/auth/calendar.events`): read, create, update and delete events on your primary calendar.

Carla only does this when you run a command, or for features you turn on yourself: recurring tasks, event reminders and the daily digest.

## What Carla stores

Carla keeps a small SQLite database on its server containing:

- Your Discord user ID.
- Your Google refresh token, **encrypted** with AES-256-GCM.
- Your settings: timezone, reminder time and digest time.
- Recurring tasks you create with `/recurring add` (title, notes and schedule).
- Records of which event reminders were already sent, kept for up to 2 days so you don't get duplicates.
- Anonymous usage counts (a one-way hash of your Discord ID and the command name, such as "tasks add").

Carla does **not** store the contents of your tasks or calendar events. They are fetched from Google when needed and shown to you in Discord.

## How your data is used

Your data is used only to provide Carla's features to you. It is not sold, shared with third parties, used for advertising, or used to train AI models.

Carla's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Deleting your data

- `/google disconnect` revokes Carla's access to your Google account and deletes your stored token.
- `/google disconnect delete_data:true` also deletes your settings and recurring tasks.
- You can also remove Carla's access at any time at <https://myaccount.google.com/permissions>.

## Contact

Questions or requests: open an issue on this project's GitHub repository.
