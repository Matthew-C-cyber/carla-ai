import { config } from '../config';
import { getUser } from '../db';
import { UserFacingError } from '../errors';
import { formatTask, taskChoiceLabel } from '../format';
import { withGoogle } from '../google/auth';
import {
  cachedTasks,
  completeTask,
  createTask,
  deleteTask,
  dueFromDate,
  invalidateTasks,
  listTasks,
  patchTask,
  reopenTask,
  resolveTask,
  type Task,
} from '../google/tasks';
import { listEmbed, parseWhen, truncate } from '../util';
import { baseCommand, type Command } from './types';

function zoneFor(discordId: string): string {
  return getUser(discordId)?.timezone ?? config.defaultTimezone;
}

function parseDue(text: string, zone: string): string {
  const parsed = parseWhen(text, zone);
  const iso = parsed?.start.toISODate();
  if (!iso) throw new UserFacingError(`I couldn't read the date "${text}". Try "tomorrow", "next friday" or "2026-11-20".`);
  return dueFromDate(iso);
}

export const tasksCommand: Command = {
  data: baseCommand('tasks', 'Manage your Google Tasks')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a task')
        .addStringOption((o) => o.setName('title').setDescription('What needs doing').setRequired(true).setMaxLength(1024))
        .addStringOption((o) => o.setName('due').setDescription('e.g. "tomorrow", "fri", "nov 20"').setMaxLength(100))
        .addStringOption((o) => o.setName('notes').setDescription('Extra details').setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Show your tasks')
        .addBooleanOption((o) => o.setName('show_completed').setDescription('Include completed tasks')),
    )
    .addSubcommand((s) =>
      s
        .setName('complete')
        .setDescription('Mark a task as done')
        .addStringOption((o) => o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reopen')
        .setDescription('Mark a completed task as not done')
        .addStringOption((o) => o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('update')
        .setDescription('Edit a task')
        .addStringOption((o) => o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(1024))
        .addStringOption((o) => o.setName('due').setDescription('New due date').setMaxLength(100))
        .addStringOption((o) => o.setName('notes').setDescription('New notes').setMaxLength(2000))
        .addBooleanOption((o) => o.setName('clear_due').setDescription('Remove the due date')),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a task')
        .addStringOption((o) => o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const zone = zoneFor(discordId);

    await withGoogle(discordId, async (auth) => {
      switch (sub) {
        case 'add': {
          const dueText = interaction.options.getString('due');
          const task = await createTask(auth, {
            title: interaction.options.getString('title', true),
            notes: interaction.options.getString('notes'),
            due: dueText ? parseDue(dueText, zone) : null,
          });
          invalidateTasks(discordId);
          await interaction.editReply(`✅ Added: ${formatTask(task, zone)}`);
          return;
        }

        case 'list': {
          const showCompleted = interaction.options.getBoolean('show_completed') ?? false;
          const tasks = await listTasks(auth, showCompleted);
          const embed = listEmbed(
            showCompleted ? '📋 All tasks' : '📋 Open tasks',
            tasks.map((t) => formatTask(t, zone)),
            'Nothing here. Add one with `/tasks add`.',
          );
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'complete':
        case 'reopen':
        case 'delete': {
          const task = await resolveTask(discordId, auth, interaction.options.getString('task', true));
          const id = task.id as string;
          if (sub === 'complete') await completeTask(auth, id);
          if (sub === 'reopen') await reopenTask(auth, id);
          if (sub === 'delete') await deleteTask(auth, id);
          invalidateTasks(discordId);
          const verb = { complete: '☑ Completed', reopen: '↩️ Reopened', delete: '🗑️ Deleted' }[sub];
          await interaction.editReply(`${verb}: **${truncate(task.title ?? '', 200)}**`);
          return;
        }

        case 'update': {
          const task = await resolveTask(discordId, auth, interaction.options.getString('task', true));
          const patch: Task = {};
          const title = interaction.options.getString('title');
          const notes = interaction.options.getString('notes');
          const dueText = interaction.options.getString('due');
          if (title) patch.title = title;
          if (notes !== null) patch.notes = notes;
          if (dueText) patch.due = parseDue(dueText, zone);
          if (interaction.options.getBoolean('clear_due')) patch.due = null;
          if (Object.keys(patch).length === 0) {
            throw new UserFacingError('Give me at least one thing to change (title, due, notes or clear_due).');
          }
          const updated = await patchTask(auth, task.id as string, patch);
          invalidateTasks(discordId);
          await interaction.editReply(`✏️ Updated: ${formatTask(updated, zone)}`);
          return;
        }
      }
    });
  },

  async autocomplete(interaction) {
    const discordId = interaction.user.id;
    const zone = zoneFor(discordId);
    const sub = interaction.options.getSubcommand();
    const typed = interaction.options.getFocused().toLowerCase();

    const tasks = await withGoogle(discordId, (auth) => cachedTasks(discordId, auth));
    const choices = tasks
      .filter((t) => (sub === 'complete' ? t.status !== 'completed' : sub === 'reopen' ? t.status === 'completed' : true))
      .filter((t) => !typed || t.title?.toLowerCase().includes(typed))
      .filter((t) => t.id && t.id.length <= 100)
      .slice(0, 25)
      .map((t) => ({ name: taskChoiceLabel(t, zone), value: t.id as string }));
    await interaction.respond(choices);
  },
};
