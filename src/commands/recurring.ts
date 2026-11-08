import { createRecurring, deleteRecurring, getUser, listRecurring } from '../db';
import { UserFacingError } from '../errors';
import { getAuthClient } from '../google/auth';
import { buildCron, describeCron, parseClock, WEEKDAYS, type Frequency } from '../schedule';
import { scheduleRecurring, unscheduleRecurring } from '../scheduler';
import { listEmbed, truncate } from '../util';
import { baseCommand, type Command } from './types';

const MAX_PER_USER = 15;

export const recurringCommand: Command = {
  data: baseCommand('recurring', 'Tasks Carla adds to Google Tasks on a schedule (cron)')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a recurring task')
        .addStringOption((o) => o.setName('title').setDescription('Task to create').setRequired(true).setMaxLength(500))
        .addStringOption((o) =>
          o
            .setName('frequency')
            .setDescription('How often')
            .setRequired(true)
            .addChoices(
              { name: 'Every day', value: 'daily' },
              { name: 'Weekdays (Mon–Fri)', value: 'weekdays' },
              { name: 'Every week', value: 'weekly' },
              { name: 'Every month', value: 'monthly' },
            ),
        )
        .addStringOption((o) =>
          o.setName('time').setDescription('Time of day, e.g. "8am" or "17:30"').setRequired(true).setMaxLength(20),
        )
        .addIntegerOption((o) =>
          o
            .setName('weekday')
            .setDescription('Day for weekly tasks')
            .addChoices(...WEEKDAYS.map((name, value) => ({ name, value }))),
        )
        .addIntegerOption((o) =>
          o.setName('day_of_month').setDescription('Day for monthly tasks (1–28)').setMinValue(1).setMaxValue(28),
        )
        .addStringOption((o) => o.setName('notes').setDescription('Notes to put on each task').setMaxLength(1000)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show your recurring tasks'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Stop a recurring task')
        .addIntegerOption((o) => o.setName('id').setDescription('Recurring task').setRequired(true).setAutocomplete(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;

    if (sub === 'add') {
      getAuthClient(discordId); // throws "connect first" if Google isn't linked
      const user = getUser(discordId);
      if (!user) throw new UserFacingError('Run `/google connect` first.');
      if (listRecurring(discordId).length >= MAX_PER_USER) {
        throw new UserFacingError(`You can have up to ${MAX_PER_USER} recurring tasks. Delete one first.`);
      }

      const frequency = interaction.options.getString('frequency', true) as Frequency;
      const timeText = interaction.options.getString('time', true);
      const clock = parseClock(timeText);
      if (!clock) throw new UserFacingError(`I couldn't read the time "${timeText}". Try "8am", "5:30pm" or "17:30".`);

      const weekday = interaction.options.getInteger('weekday') ?? undefined;
      const dayOfMonth = interaction.options.getInteger('day_of_month') ?? undefined;
      if (frequency === 'weekly' && weekday === undefined) throw new UserFacingError('Weekly tasks need a `weekday`.');
      if (frequency === 'monthly' && dayOfMonth === undefined) throw new UserFacingError('Monthly tasks need a `day_of_month`.');

      const cronExpr = buildCron({ frequency, clock, weekday, dayOfMonth });
      const row = createRecurring(
        discordId,
        interaction.options.getString('title', true),
        interaction.options.getString('notes'),
        cronExpr,
      );
      scheduleRecurring(row, user.timezone);
      await interaction.editReply(
        `🔁 Recurring task **#${row.id} ${truncate(row.title, 200)}** will be added to Google Tasks ` +
          `${describeCron(cronExpr)} (${user.timezone}). I'll DM you each time.`,
      );
      return;
    }

    if (sub === 'list') {
      const rows = listRecurring(discordId);
      const embed = listEmbed(
        '🔁 Recurring tasks',
        rows.map((r) => `**#${r.id}** ${truncate(r.title, 150)} — ${describeCron(r.cron_expr)}`),
        'None yet. Create one with `/recurring add`.',
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      if (!deleteRecurring(discordId, id)) throw new UserFacingError(`You don't have a recurring task #${id}.`);
      unscheduleRecurring(id);
      await interaction.editReply(`🛑 Stopped recurring task #${id}.`);
    }
  },

  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused()).toLowerCase();
    const choices = listRecurring(interaction.user.id)
      .filter((r) => !typed || r.title.toLowerCase().includes(typed) || String(r.id) === typed)
      .slice(0, 25)
      .map((r) => ({ name: truncate(`#${r.id} ${r.title} · ${describeCron(r.cron_expr)}`, 100), value: r.id }));
    await interaction.respond(choices);
  },
};
