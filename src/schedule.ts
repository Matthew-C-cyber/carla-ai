/**
 * Pure helpers for recurring-task schedules (no dependencies, easy to unit test).
 * Schedules are stored as standard 5-field cron expressions: "minute hour day-of-month month day-of-week".
 */

export type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface Clock {
  hour: number;
  minute: number;
}

/** Accepts "9am", "9:30 pm", "21:30", "0730", "noon", "midnight". Returns null if invalid. */
export function parseClock(input: string): Clock | null {
  const text = input.trim().toLowerCase().replace(/\./g, '');
  if (text === 'noon') return { hour: 12, minute: 0 };
  if (text === 'midnight') return { hour: 0, minute: 0 };

  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.startsWith('p');
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

/** "HH:mm", the format digest times are stored in. */
export function toHHmm({ hour, minute }: Clock): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatClock({ hour, minute }: Clock): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export interface ScheduleInput {
  frequency: Frequency;
  clock: Clock;
  /** 0 = Sunday ... 6 = Saturday (weekly only) */
  weekday?: number;
  /** 1-28 (monthly only) */
  dayOfMonth?: number;
}

export function buildCron(input: ScheduleInput): string {
  const { minute, hour } = input.clock;
  switch (input.frequency) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly': {
      const day = input.weekday;
      if (day === undefined || day < 0 || day > 6) throw new RangeError('weekly schedules need a weekday (0-6)');
      return `${minute} ${hour} * * ${day}`;
    }
    case 'monthly': {
      const dom = input.dayOfMonth;
      if (dom === undefined || dom < 1 || dom > 28) throw new RangeError('monthly schedules need a day of month (1-28)');
      return `${minute} ${hour} ${dom} * *`;
    }
  }
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Human-readable description of a cron expression produced by buildCron. */
export function describeCron(expr: string): string {
  const [minute, hour, dom, , dow] = expr.trim().split(/\s+/);
  const at = `at ${formatClock({ hour: Number(hour), minute: Number(minute) })}`;
  if (dow === '1-5') return `every weekday ${at}`;
  if (dow !== undefined && dow !== '*') return `every ${WEEKDAYS[Number(dow)] ?? `day ${dow}`} ${at}`;
  if (dom !== undefined && dom !== '*') return `on the ${ordinal(Number(dom))} of every month ${at}`;
  return `every day ${at}`;
}
