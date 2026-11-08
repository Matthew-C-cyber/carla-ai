import { calendarCommand } from './calendar';
import { googleCommand, googleComponents } from './google';
import { helpCommand } from './help';
import { recurringCommand } from './recurring';
import { settingsCommand } from './settings';
import { statsCommand } from './stats';
import { tasksCommand } from './tasks';
import type { Command, ComponentHandler } from './types';

export const commands: Command[] = [
  googleCommand,
  tasksCommand,
  calendarCommand,
  recurringCommand,
  settingsCommand,
  statsCommand,
  helpCommand,
];

export const componentHandlers: ComponentHandler[] = [googleComponents];
