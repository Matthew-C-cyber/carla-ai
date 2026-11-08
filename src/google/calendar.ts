import { google, type calendar_v3 } from 'googleapis';
import { DateTime } from 'luxon';
import { UserFacingError } from '../errors';
import type { OAuthClient } from './auth';

export type CalEvent = calendar_v3.Schema$Event;

const CALENDAR = 'primary';
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; events: CalEvent[] }>();

function api(auth: OAuthClient) {
  return google.calendar({ version: 'v3', auth });
}

export interface When {
  start: DateTime;
  end: DateTime;
  allDay: boolean;
}

/** All-day events use exclusive end dates in Google Calendar (a one-day event ends the next day). */
export function buildWhen(start: DateTime, hasTime: boolean, durationMinutes: number): When {
  return hasTime
    ? { start, end: start.plus({ minutes: durationMinutes }), allDay: false }
    : { start: start.startOf('day'), end: start.startOf('day').plus({ days: 1 }), allDay: true };
}

export function toEventTimes(when: When, zone: string): Pick<CalEvent, 'start' | 'end'> {
  if (when.allDay) {
    return {
      start: { date: when.start.toISODate(), dateTime: null },
      end: { date: when.end.toISODate(), dateTime: null },
    };
  }
  return {
    start: { dateTime: when.start.toISO(), timeZone: zone, date: null },
    end: { dateTime: when.end.toISO(), timeZone: zone, date: null },
  };
}

export function isAllDay(event: CalEvent): boolean {
  return Boolean(event.start?.date && !event.start?.dateTime);
}

export function eventStart(event: CalEvent, zone: string): DateTime | null {
  if (event.start?.dateTime) return DateTime.fromISO(event.start.dateTime).setZone(zone);
  if (event.start?.date) return DateTime.fromISO(event.start.date, { zone });
  return null;
}

export function eventEnd(event: CalEvent, zone: string): DateTime | null {
  if (event.end?.dateTime) return DateTime.fromISO(event.end.dateTime).setZone(zone);
  if (event.end?.date) return DateTime.fromISO(event.end.date, { zone });
  return null;
}

export async function listEvents(auth: OAuthClient, from: DateTime, to: DateTime, max = 50): Promise<CalEvent[]> {
  const res = await api(auth).events.list({
    calendarId: CALENDAR,
    timeMin: from.toUTC().toISO() ?? undefined,
    timeMax: to.toUTC().toISO() ?? undefined,
    singleEvents: true, // expand recurring events into individual occurrences
    orderBy: 'startTime',
    maxResults: max,
  });
  return (res.data.items ?? []).filter((e) => e.status !== 'cancelled');
}

export async function getEvent(auth: OAuthClient, eventId: string): Promise<CalEvent> {
  const res = await api(auth).events.get({ calendarId: CALENDAR, eventId });
  return res.data;
}

export async function createEvent(
  auth: OAuthClient,
  input: { title: string; when: When; zone: string; location?: string | null; description?: string | null },
): Promise<CalEvent> {
  const res = await api(auth).events.insert({
    calendarId: CALENDAR,
    requestBody: {
      summary: input.title,
      location: input.location ?? undefined,
      description: input.description ?? undefined,
      ...toEventTimes(input.when, input.zone),
    },
  });
  return res.data;
}

export async function patchEvent(auth: OAuthClient, eventId: string, body: CalEvent): Promise<CalEvent> {
  const res = await api(auth).events.patch({ calendarId: CALENDAR, eventId, requestBody: body });
  return res.data;
}

export async function deleteEvent(auth: OAuthClient, eventId: string): Promise<void> {
  await api(auth).events.delete({ calendarId: CALENDAR, eventId });
}

// ---------- autocomplete support ----------

/** Events from yesterday through the next 60 days, cached briefly for autocomplete. */
export async function cachedEvents(discordId: string, auth: OAuthClient): Promise<CalEvent[]> {
  const hit = cache.get(discordId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;
  const now = DateTime.utc();
  const events = await listEvents(auth, now.minus({ days: 1 }), now.plus({ days: 60 }), 100);
  cache.set(discordId, { at: Date.now(), events });
  return events;
}

export function invalidateEvents(discordId: string): void {
  cache.delete(discordId);
}

export async function resolveEvent(discordId: string, auth: OAuthClient, input: string): Promise<CalEvent> {
  const events = await cachedEvents(discordId, auth);
  const needle = input.trim().toLowerCase();
  const found =
    events.find((e) => e.id === input) ??
    events.find((e) => e.summary?.trim().toLowerCase() === needle) ??
    events.find((e) => e.summary?.toLowerCase().includes(needle));
  if (found?.id) return found;

  // Might be an ID outside the cached window.
  if (/^[a-z0-9_]{5,}$/i.test(input)) {
    try {
      return await getEvent(auth, input);
    } catch {
      // fall through to the friendly error
    }
  }
  throw new UserFacingError(`No event matches "${input}". Pick one from the suggestions list.`);
}
