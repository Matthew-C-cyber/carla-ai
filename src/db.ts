import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './config';
import { pseudonym } from './crypto';

mkdirSync(dirname(resolve(config.databasePath)), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id        TEXT PRIMARY KEY,
    refresh_token_enc TEXT,
    timezone          TEXT NOT NULL,
    digest_time       TEXT,
    last_digest_on    TEXT,
    reminder_minutes  INTEGER DEFAULT 10,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state      TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    notes      TEXT,
    cron_expr  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sent_reminders (
    discord_id TEXT NOT NULL,
    event_id   TEXT NOT NULL,
    start_at   TEXT NOT NULL,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (discord_id, event_id, start_at)
  );

  CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_hash  TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
`);

export interface UserRow {
  discord_id: string;
  refresh_token_enc: string | null;
  timezone: string;
  digest_time: string | null;
  last_digest_on: string | null;
  reminder_minutes: number | null;
  created_at: string;
}

export interface RecurringRow {
  id: number;
  discord_id: string;
  title: string;
  notes: string | null;
  cron_expr: string;
  created_at: string;
}

// ---------- users ----------

export function getUser(discordId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as UserRow | undefined;
}

/** Make sure a settings row exists (so /settings works before Google is linked). */
export function ensureUser(discordId: string): UserRow {
  db.prepare('INSERT OR IGNORE INTO users (discord_id, timezone) VALUES (?, ?)').run(discordId, config.defaultTimezone);
  return getUser(discordId) as UserRow;
}

/** Store the (encrypted) refresh token. Existing settings are kept on re-link. */
export function saveLink(discordId: string, refreshTokenEnc: string): void {
  db.prepare(
    `INSERT INTO users (discord_id, refresh_token_enc, timezone) VALUES (?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc`,
  ).run(discordId, refreshTokenEnc, config.defaultTimezone);
}

export function clearRefreshToken(discordId: string): void {
  db.prepare('UPDATE users SET refresh_token_enc = NULL WHERE discord_id = ?').run(discordId);
}

export function deleteUserData(discordId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM sent_reminders WHERE discord_id = ?').run(discordId);
    db.prepare('DELETE FROM oauth_states WHERE discord_id = ?').run(discordId);
    db.prepare('DELETE FROM users WHERE discord_id = ?').run(discordId); // cascades to recurring_jobs
  })();
}

type SettingsFields = Partial<Pick<UserRow, 'timezone' | 'digest_time' | 'last_digest_on' | 'reminder_minutes'>>;

export function updateUserSettings(discordId: string, fields: SettingsFields): void {
  const allowed = ['timezone', 'digest_time', 'last_digest_on', 'reminder_minutes'] as const; // column whitelist
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const column of allowed) {
    if (column in fields) {
      sets.push(`${column} = ?`);
      values.push(fields[column] ?? null);
    }
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE discord_id = ?`).run(...values, discordId);
}

export function listLinkedUsers(): UserRow[] {
  return db.prepare('SELECT * FROM users WHERE refresh_token_enc IS NOT NULL').all() as UserRow[];
}

// ---------- OAuth state (CSRF protection for the Google link flow) ----------

export function saveOAuthState(state: string, discordId: string, ttlMs: number): void {
  db.prepare('INSERT INTO oauth_states (state, discord_id, expires_at) VALUES (?, ?, ?)').run(
    state,
    discordId,
    Date.now() + ttlMs,
  );
}

/** Single use: returns the Discord user the state was issued to, or undefined if unknown/expired. */
export function consumeOAuthState(state: string): string | undefined {
  const row = db.prepare('SELECT discord_id, expires_at FROM oauth_states WHERE state = ?').get(state) as
    | { discord_id: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  return row.expires_at > Date.now() ? row.discord_id : undefined;
}

// ---------- recurring jobs ----------

export function createRecurring(discordId: string, title: string, notes: string | null, cronExpr: string): RecurringRow {
  const info = db
    .prepare('INSERT INTO recurring_jobs (discord_id, title, notes, cron_expr) VALUES (?, ?, ?, ?)')
    .run(discordId, title, notes, cronExpr);
  return getRecurring(Number(info.lastInsertRowid)) as RecurringRow;
}

export function getRecurring(id: number): RecurringRow | undefined {
  return db.prepare('SELECT * FROM recurring_jobs WHERE id = ?').get(id) as RecurringRow | undefined;
}

export function listRecurring(discordId: string): RecurringRow[] {
  return db.prepare('SELECT * FROM recurring_jobs WHERE discord_id = ? ORDER BY id').all(discordId) as RecurringRow[];
}

export function listAllRecurring(): (RecurringRow & { timezone: string })[] {
  return db
    .prepare('SELECT r.*, u.timezone FROM recurring_jobs r JOIN users u ON u.discord_id = r.discord_id ORDER BY r.id')
    .all() as (RecurringRow & { timezone: string })[];
}

export function deleteRecurring(discordId: string, id: number): boolean {
  return db.prepare('DELETE FROM recurring_jobs WHERE id = ? AND discord_id = ?').run(id, discordId).changes > 0;
}

// ---------- event reminders (idempotency) ----------

export function hasSentReminder(discordId: string, eventId: string, startAt: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM sent_reminders WHERE discord_id = ? AND event_id = ? AND start_at = ?')
      .get(discordId, eventId, startAt) !== undefined
  );
}

export function markReminderSent(discordId: string, eventId: string, startAt: string): void {
  db.prepare('INSERT OR IGNORE INTO sent_reminders (discord_id, event_id, start_at) VALUES (?, ?, ?)').run(
    discordId,
    eventId,
    startAt,
  );
}

export function purgeStale(): void {
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
  db.prepare("DELETE FROM sent_reminders WHERE sent_at < datetime('now', '-2 days')").run();
}

// ---------- usage stats (pseudonymous: no command content, no raw user IDs) ----------

export function logActivity(discordId: string, name: string): void {
  db.prepare('INSERT INTO activity (user_hash, name) VALUES (?, ?)').run(pseudonym(discordId), name);
}

export interface Stats {
  linkedUsers: number;
  recurringJobs: number;
  commandsTotal: number;
  commands30d: number;
  usersEver: number;
  activeUsers30d: number;
  automatedRuns: number;
  topCommands: { name: string; n: number }[];
}

function count(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

export function getStats(): Stats {
  const isCommand = "name NOT LIKE 'job:%'";
  const recent = "created_at >= datetime('now', '-30 days')";
  return {
    linkedUsers: count('SELECT COUNT(*) AS n FROM users WHERE refresh_token_enc IS NOT NULL'),
    recurringJobs: count('SELECT COUNT(*) AS n FROM recurring_jobs'),
    commandsTotal: count(`SELECT COUNT(*) AS n FROM activity WHERE ${isCommand}`),
    commands30d: count(`SELECT COUNT(*) AS n FROM activity WHERE ${isCommand} AND ${recent}`),
    usersEver: count(`SELECT COUNT(DISTINCT user_hash) AS n FROM activity WHERE ${isCommand}`),
    activeUsers30d: count(`SELECT COUNT(DISTINCT user_hash) AS n FROM activity WHERE ${isCommand} AND ${recent}`),
    automatedRuns: count("SELECT COUNT(*) AS n FROM activity WHERE name LIKE 'job:%'"),
    topCommands: db
      .prepare(`SELECT name, COUNT(*) AS n FROM activity WHERE ${isCommand} GROUP BY name ORDER BY n DESC LIMIT 5`)
      .all() as { name: string; n: number }[],
  };
}
