import { DateTime } from 'luxon';
import { config } from '../config';
import { getUser } from '../db';
import { UserFacingError } from '../errors';
import { eventChoiceLabel, formatEvent } from '../format';
import { withGoogle } from '../google/auth';
import {
  buildWhen,
  cachedEvents,
  createEvent,
  deleteEvent,
  eventEnd,
  eventStart,
  invalidateEvents,
  isAllDay,
  listEvents,
  patchEvent,
  resolveEvent,
  toEventTimes,
  type CalEvent,
} from '../google/calendar';
import { listEmbed, parseWhen, truncate } from '../util';
import { baseCommand, type Command } from './types';

const DEFAULT_DURATION = 60;

function zoneFor(discordId: string): string {
  return getUser(discordId)?.timezone ?? config.defaultTimezone;
}

function parseOrThrow(text: string, zone: string) {
  const parsed = parseWhen(text, zone);
  if (!parsed) {
    throw new UserFacingError(`I couldn't read "${text}". Try "tomorrow 3pm", "fri 10:30am" or "nov 20" (all day).`);
  }
  return parsed;
}

export const calendarCommand: Command = {
  data: baseCommand('calendar', 'Manage your Google Calendar')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create an event')
        .addStringOption((o) => o.setName('title').setDescription('Event name').setRequired(true).setMaxLength(500))
        .addStringOption((o) =>
          o
            .setName('when')
            .setDescription('e.g. "tomorrow 3pm", "fri 10:30am"; a date with no time makes an all-day event')
            .setRequired(true)
            .setMaxLength(100),
        )
        .addIntegerOption((o) =>
          o.setName('duration').setDescription('Length in minutes (default 60)').setMinValue(5).setMaxValue(1440),
        )
        .addStringOption((o) => o.setName('location').setDescription('Where').setMaxLength(500))
        .addStringOption((o) => o.setName('description').setDescription('Details').setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Show upcoming events')
        .addIntegerOption((o) =>
          o.setName('days').setDescription('How many days ahead (default 7)').setMinValue(1).setMaxValue(31),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('update')
        .setDescription('Edit an event')
        .addStringOption((o) => o.setName('event').setDescription('Event').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('title').setDescription('New name').setMaxLength(500))
        .addStringOption((o) => o.setName('when').setDescription('New start time').setMaxLength(100))
        .addIntegerOption((o) =>
          o.setName('duration').setDescription('New length in minutes').setMinValue(5).setMaxValue(1440),
        )
        .addStringOption((o) => o.setName('location').setDescription('New location').setMaxLength(500))
        .addStringOption((o) => o.setName('description').setDescription('New details').setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete an event')
        .addStringOption((o) => o.setName('event').setDescription('Event').setRequired(true).setAutocomplete(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const zone = zoneFor(discordId);

    await withGoogle(discordId, async (auth) => {
      switch (sub) {
        case 'add': {
          const parsed = parseOrThrow(interaction.options.getString('when', true), zone);
          const duration = interaction.options.getInteger('duration') ?? DEFAULT_DURATION;
          const event = await createEvent(auth, {
            title: interaction.options.getString('title', true),
            when: buildWhen(parsed.start, parsed.hasTime, duration),
            zone,
            location: interaction.options.getString('location'),
            description: interaction.options.getString('description'),
          });
          invalidateEvents(discordId);
          const link = event.htmlLink ? `\n[Open in Google Calendar](${event.htmlLink})` : '';
          await interaction.editReply(`📅 Added: ${formatEvent(event, zone)}${link}`);
          return;
        }

        case 'list': {
          const days = interaction.options.getInteger('days') ?? 7;
          const now = DateTime.now().setZone(zone);
          const events = await listEvents(auth, now, now.plus({ days }).endOf('day'), 50);
          const embed = listEmbed(
            `📅 Next ${days} day${days === 1 ? '' : 's'}`,
            events.map((e) => formatEvent(e, zone)),
            'No events coming up. Add one with `/calendar add`.',
          );
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'update': {
          const event = await resolveEvent(discordId, auth, interaction.options.getString('event', true));
          const patch: CalEvent = {};
          const title = interaction.options.getString('title');
          const whenText = interaction.options.getString('when');
          const duration = interaction.options.getInteger('duration');
          const location = interaction.options.getString('location');
          const description = interaction.options.getString('description');

          if (title) patch.summary = title;
          if (location !== null) patch.location = location;
          if (description !== null) patch.description = description;

          const oldStart = eventStart(event, zone);
          const oldEnd = eventEnd(event, zone);
          const oldMinutes =
            oldStart && oldEnd && !isAllDay(event) ? Math.round(oldEnd.diff(oldStart, 'minutes').minutes) : DEFAULT_DURATION;

          if (whenText) {
            const parsed = parseOrThrow(whenText, zone);
            Object.assign(patch, toEventTimes(buildWhen(parsed.start, parsed.hasTime, duration ?? oldMinutes), zone));
          } else if (duration !== null) {
            if (!oldStart || isAllDay(event)) {
              throw new UserFacingError('All-day events have no duration. Give a `when` with a time instead.');
            }
            Object.assign(patch, toEventTimes(buildWhen(oldStart, true, duration), zone));
          }

          if (Object.keys(patch).length === 0) {
            throw new UserFacingError('Give me at least one thing to change (title, when, duration, location or description).');
          }
          const updated = await patchEvent(auth, event.id as string, patch);
          invalidateEvents(discordId);
          await interaction.editReply(`✏️ Updated: ${formatEvent(updated, zone)}`);
          return;
        }

        case 'delete': {
          const event = await resolveEvent(discordId, auth, interaction.options.getString('event', true));
          await deleteEvent(auth, event.id as string);
          invalidateEvents(discordId);
          await interaction.editReply(`🗑️ Deleted: **${truncate(event.summary ?? '(no title)', 200)}**`);
          return;
        }
      }
    });
  },

  async autocomplete(interaction) {
    const discordId = interaction.user.id;
    const zone = zoneFor(discordId);
    const typed = interaction.options.getFocused().toLowerCase();
    const events = await withGoogle(discordId, (auth) => cachedEvents(discordId, auth));
    const choices = events
      .filter((e) => !typed || e.summary?.toLowerCase().includes(typed))
      .filter((e) => e.id && e.id.length <= 100)
      .slice(0, 25)
      .map((e) => ({ name: eventChoiceLabel(e, zone), value: e.id as string }));
    await interaction.respond(choices);
  },
};
