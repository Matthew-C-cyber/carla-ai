import { EmbedBuilder, type Client, type MessageCreateOptions } from 'discord.js';
import { DateTime } from 'luxon';
import { schedule, type ScheduledTask } from 'node-cron';
import { pseudonym } from './crypto';
import {
  getRecurring,
  getUser,
  hasSentReminder,
  listAllRecurring,
  listLinkedUsers,
  listRecurring,
  logActivity,
  markReminderSent,
  purgeStale,
  updateUserSettings,
  type RecurringRow,
  type UserRow,
} from './db';
import { UserFacingError } from './errors';
import { formatEvent, formatTask } from './format';
import { withGoogle } from './google/auth';
import { eventStart, isAllDay, listEvents } from './google/calendar';
import { createTask, dueDate, dueFromDate, invalidateTasks, listTasks } from './google/tasks';
import { BRAND_COLOR, joinLines, truncate } from './util';

let client: Client | null = null;
const recurringJobs = new Map<number, ScheduledTask>();
let ticking = false;

// ---------- startup ----------

export function startScheduler(discordClient: Client): void {
  client = discordClient;

  for (const row of listAllRecurring()) scheduleRecurring(row, row.timezone);

  // Every minute: daily digests and event reminders.
  schedule('* * * * *', () => void tick());
  // Hourly housekeeping.
  schedule('17 * * * *', () => purgeStale());

  console.log(`[scheduler] started with ${recurringJobs.size} recurring job(s)`);
}

// ---------- recurring tasks (one cron job per row, in the user's timezone) ----------

export function scheduleRecurring(row: RecurringRow, timezone: string): void {
  unscheduleRecurring(row.id);
  const job = schedule(row.cron_expr, () => void runRecurring(row.id), { timezone });
  recurringJobs.set(row.id, job);
}

export function unscheduleRecurring(id: number): void {
  recurringJobs.get(id)?.stop();
  recurringJobs.delete(id);
}

/** Re-create a user's jobs, e.g. after they change timezone. */
export function rescheduleUser(discordId: string): void {
  const user = getUser(discordId);
  if (!user) return;
  for (const row of listRecurring(discordId)) scheduleRecurring(row, user.timezone);
}

export function unscheduleUser(discordId: string): void {
  for (const row of listRecurring(discordId)) unscheduleRecurring(row.id);
}

async function runRecurring(id: number): Promise<void> {
  const row = getRecurring(id);
  if (!row) return unscheduleRecurring(id);
  const user = getUser(row.discord_id);
  if (!user?.refresh_token_enc) return; // paused until they reconnect

  try {
    const today = DateTime.now().setZone(user.timezone).toISODate();
    await withGoogle(row.discord_id, (auth) =>
      createTask(auth, { title: row.title, notes: row.notes, due: today ? dueFromDate(today) : null }),
    );
    invalidateTasks(row.discord_id);
    logActivity(row.discord_id, 'job:recurring');
    await dm(row.discord_id, `🔁 Added **${truncate(row.title, 200)}** to your Google Tasks (due today).`);
  } catch (err) {
    if (err instanceof UserFacingError) {
      await dm(row.discord_id, `⚠️ Couldn't add your recurring task **${truncate(row.title, 200)}**: ${err.message}`);
    } else {
      console.error(`[scheduler] recurring #${id} failed:`, err);
    }
  }
}

// ---------- per-minute tick: digests + reminders ----------

async function tick(): Promise<void> {
  if (ticking) return; // previous tick still running; skip rather than pile up
  ticking = true;
  try {
    const users = listLinkedUsers();
    await Promise.allSettled(users.map((u) => tickUser(u)));
  } finally {
    ticking = false;
  }
}

async function tickUser(user: UserRow): Promise<void> {
  const now = DateTime.now().setZone(user.timezone);
  try {
    // ">=" plus last_digest_on means a digest is never skipped if a tick is missed.
    if (user.digest_time && now.toFormat('HH:mm') >= user.digest_time && user.last_digest_on !== now.toISODate()) {
      await sendDigest(user, now);
    }
    if (user.reminder_minutes && user.reminder_minutes > 0) {
      await sendReminders(user, now, user.reminder_minutes);
    }
  } catch (err) {
    if (err instanceof UserFacingError) await dm(user.discord_id, `⚠️ ${err.message}`);
    else console.error(`[scheduler] tick failed for ${pseudonym(user.discord_id)}:`, err);
  }
}

async function sendDigest(user: UserRow, now: DateTime): Promise<void> {
  const today = now.toISODate() as string;
  // Mark first so a failing DM can't cause a retry every minute.
  updateUserSettings(user.discord_id, { last_digest_on: today });

  const [events, tasks] = await withGoogle(user.discord_id, (auth) =>
    Promise.all([listEvents(auth, now.startOf('day'), now.endOf('day'), 25), listTasks(auth, false)]),
  );
  const dueTasks = tasks.filter((t) => {
    const due = dueDate(t);
    return due !== null && due <= today;
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`☀️ Your day: ${now.toFormat('cccc, LLLL d')}`)
    .addFields(
      {
        name: `📅 Events (${events.length})`,
        value: events.length ? joinLines(events.map((e) => formatEvent(e, user.timezone)), 1024) : 'Nothing scheduled.',
      },
      {
        name: `📋 Tasks due (${dueTasks.length})`,
        value: dueTasks.length ? joinLines(dueTasks.map((t) => formatTask(t, user.timezone)), 1024) : 'All clear.',
      },
    );
  await dm(user.discord_id, { embeds: [embed] });
  logActivity(user.discord_id, 'job:digest');
}

async function sendReminders(user: UserRow, now: DateTime, minutes: number): Promise<void> {
  const events = await withGoogle(user.discord_id, (auth) => listEvents(auth, now, now.plus({ minutes }), 10));
  for (const event of events) {
    if (!event.id || isAllDay(event)) continue;
    const start = eventStart(event, user.timezone);
    if (!start || start < now.minus({ minutes: 1 })) continue; // already underway
    const startKey = start.toUTC().toISO() as string;
    if (hasSentReminder(user.discord_id, event.id, startKey)) continue;

    markReminderSent(user.discord_id, event.id, startKey);
    await dm(user.discord_id, `⏰ Starting <t:${Math.floor(start.toSeconds())}:R>: ${formatEvent(event, user.timezone)}`);
    logActivity(user.discord_id, 'job:reminder');
  }
}

// ---------- DMs ----------

async function dm(discordId: string, payload: string | MessageCreateOptions): Promise<void> {
  if (!client) return;
  try {
    const user = await client.users.fetch(discordId);
    await user.send(payload);
  } catch (err) {
    // Usually the user has DMs from server members turned off.
    console.warn(`[scheduler] could not DM ${pseudonym(discordId)}: ${(err as Error).message}`);
  }
}
