import { DateTime } from 'luxon';
import { ensureUser, updateUserSettings } from '../db';
import { UserFacingError } from '../errors';
import { formatClock, parseClock, toHHmm } from '../schedule';
import { rescheduleUser } from '../scheduler';
import { isValidZone } from '../util';
import { baseCommand, type Command } from './types';

const ALL_ZONES = Intl.supportedValuesOf('timeZone');

export const settingsCommand: Command = {
  data: baseCommand('settings', 'Timezone, reminders and your daily digest')
    .addSubcommand((s) =>
      s
        .setName('timezone')
        .setDescription('Set your timezone (used for dates, reminders and recurring tasks)')
        .addStringOption((o) =>
          o.setName('zone').setDescription('e.g. America/New_York').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reminders')
        .setDescription('DM me before calendar events start')
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Minutes before each event (0 turns reminders off)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(120),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('digest')
        .setDescription("DM me a summary of today's events and tasks every morning")
        .addStringOption((o) =>
          o.setName('time').setDescription('e.g. "7:30am", or "off"').setRequired(true).setMaxLength(20),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const user = ensureUser(discordId);

    if (sub === 'timezone') {
      const zone = interaction.options.getString('zone', true).trim();
      if (!isValidZone(zone)) {
        throw new UserFacingError(`"${zone}" isn't a timezone I know. Pick one from the list, e.g. America/New_York.`);
      }
      updateUserSettings(discordId, { timezone: zone });
      rescheduleUser(discordId);
      const now = DateTime.now().setZone(zone).toFormat('h:mm a');
      await interaction.editReply(`🌎 Timezone set to **${zone}** (it's ${now} there).`);
      return;
    }

    if (sub === 'reminders') {
      const minutes = interaction.options.getInteger('minutes', true);
      updateUserSettings(discordId, { reminder_minutes: minutes });
      await interaction.editReply(
        minutes === 0 ? '🔕 Event reminders are off.' : `🔔 I'll DM you ${minutes} minutes before each event.`,
      );
      return;
    }

    if (sub === 'digest') {
      const text = interaction.options.getString('time', true).trim().toLowerCase();
      if (['off', 'none', 'stop', 'disable'].includes(text)) {
        updateUserSettings(discordId, { digest_time: null });
        await interaction.editReply('🔕 Daily digest is off.');
        return;
      }
      const clock = parseClock(text);
      if (!clock) throw new UserFacingError(`I couldn't read the time "${text}". Try "7am" or "07:30".`);

      // If that time already passed today, start tomorrow instead of sending one right now.
      const now = DateTime.now().setZone(user.timezone);
      const passed = now.toFormat('HH:mm') >= toHHmm(clock);
      updateUserSettings(discordId, { digest_time: toHHmm(clock), last_digest_on: passed ? now.toISODate() : null });
      await interaction.editReply(`☀️ I'll DM your daily digest at **${formatClock(clock)}** (${user.timezone}).`);
    }
  },

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase().replace(/\s+/g, '_');
    const matches = typed ? ALL_ZONES.filter((z) => z.toLowerCase().includes(typed)) : ALL_ZONES;
    await interaction.respond(matches.slice(0, 25).map((z) => ({ name: z, value: z })));
  },
};
