import * as chrono from 'chrono-node';
import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';

export const BRAND_COLOR = 0x5865f2;

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function isValidZone(zone: string): boolean {
  return DateTime.now().setZone(zone).isValid;
}

export interface ParsedWhen {
  start: DateTime;
  /** false when the text only named a day ("friday"), so there is no clock time. */
  hasTime: boolean;
}

/**
 * Parse natural language ("tomorrow 3pm", "fri 10:00", "2026-11-20 14:30") in the user's timezone.
 * chrono-node reads "now" from local clock fields, so we hand it a Date whose fields match the
 * user's wall clock, then re-interpret the parsed fields in the user's real zone with luxon.
 * (The bot server usually runs in UTC; the user is usually not.)
 */
export function parseWhen(text: string, zone: string): ParsedWhen | null {
  const now = DateTime.now().setZone(zone);
  const reference = new Date(now.year, now.month - 1, now.day, now.hour, now.minute, now.second);
  const result = chrono.parse(text, reference, { forwardDate: true })[0];
  if (!result) return null;

  const hasTime = result.start.isCertain('hour');
  const parsed = result.start.date();

  // The text named its own zone ("3pm EST"): the parsed value is already a real instant.
  if (result.start.isCertain('timezoneOffset')) {
    return { start: DateTime.fromJSDate(parsed).setZone(zone), hasTime };
  }

  const start = DateTime.fromObject(
    {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      day: parsed.getDate(),
      hour: hasTime ? parsed.getHours() : 0,
      minute: hasTime ? parsed.getMinutes() : 0,
    },
    { zone },
  );
  return start.isValid ? { start, hasTime } : null;
}

/** Join lines into one string no longer than maxChars, ending with "…and N more" if cut. */
export function joinLines(lines: string[], maxChars: number): string {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (used + line.length + 1 > maxChars - 30) {
      out.push(`…and ${lines.length - i} more`);
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

export function listEmbed(title: string, lines: string[], emptyText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(title)
    .setDescription(lines.length > 0 ? joinLines(lines, 4000) : emptyText);
}
