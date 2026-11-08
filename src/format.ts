import { DateTime } from 'luxon';
import { eventEnd, eventStart, isAllDay, type CalEvent } from './google/calendar';
import { dueDate, type Task } from './google/tasks';
import { truncate } from './util';

/** Short label for a task's due date relative to today in the user's timezone. */
export function dueLabel(task: Task, zone: string): string | null {
  const due = dueDate(task);
  if (!due) return null;
  const today = DateTime.now().setZone(zone).startOf('day');
  const date = DateTime.fromISO(due, { zone }).startOf('day');
  const days = Math.round(date.diff(today, 'days').days);
  if (task.status !== 'completed' && days < 0) return `⚠️ overdue (${date.toFormat('LLL d')})`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return date.toFormat('cccc');
  return date.toFormat(date.year === today.year ? 'ccc, LLL d' : 'LLL d, yyyy');
}

export function formatTask(task: Task, zone: string): string {
  const done = task.status === 'completed';
  const title = truncate(task.title ?? '(untitled)', 120);
  const due = dueLabel(task, zone);
  return `${done ? '☑' : '☐'} ${done ? `~~${title}~~` : `**${title}**`}${due ? ` — due ${due}` : ''}`;
}

/** Discord timestamps (<t:…>) render in each viewer's own timezone automatically. */
function discordTime(dt: DateTime, style: 't' | 'f' | 'F' | 'R'): string {
  return `<t:${Math.floor(dt.toSeconds())}:${style}>`;
}

export function formatEvent(event: CalEvent, zone: string): string {
  const title = truncate(event.summary ?? '(no title)', 120);
  const start = eventStart(event, zone);
  const end = eventEnd(event, zone);
  let when = '';
  if (start && isAllDay(event)) {
    const lastDay = end ? end.minus({ days: 1 }) : start;
    when = lastDay.hasSame(start, 'day')
      ? `${start.toFormat('ccc, LLL d')} · all day`
      : `${start.toFormat('LLL d')} – ${lastDay.toFormat('LLL d')} · all day`;
  } else if (start) {
    when = end ? `${discordTime(start, 'f')} – ${discordTime(end, 't')}` : discordTime(start, 'f');
  }
  const location = event.location ? `\n  📍 ${truncate(event.location, 80)}` : '';
  return `**${title}** — ${when}${location}`;
}

/** Autocomplete label (plain text, max 100 chars; Discord can't render markdown or <t:> here). */
export function eventChoiceLabel(event: CalEvent, zone: string): string {
  const start = eventStart(event, zone);
  const when = start ? (isAllDay(event) ? start.toFormat('ccc LLL d') : start.toFormat('ccc LLL d, h:mm a')) : '';
  return truncate(`${event.summary ?? '(no title)'} · ${when}`, 100);
}

export function taskChoiceLabel(task: Task, zone: string): string {
  const due = dueLabel(task, zone);
  const icon = task.status === 'completed' ? '☑' : '☐';
  return truncate(`${icon} ${task.title ?? '(untitled)'}${due ? ` · due ${due.replace('⚠️ ', '')}` : ''}`, 100);
}
