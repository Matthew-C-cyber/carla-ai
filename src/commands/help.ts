import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR } from '../util';
import { baseCommand, type Command } from './types';

export const helpCommand: Command = {
  data: baseCommand('help', 'What Carla can do'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('👋 Carla AI')
      .setDescription('Your Google Tasks and Google Calendar, from Discord. Replies are only visible to you.')
      .addFields(
        { name: 'Get started', value: '`/google connect` · `/google status` · `/google disconnect`' },
        {
          name: 'Tasks',
          value: '`/tasks add` · `/tasks list` · `/tasks complete` · `/tasks reopen` · `/tasks update` · `/tasks delete`',
        },
        { name: 'Calendar', value: '`/calendar add` · `/calendar list` · `/calendar update` · `/calendar delete`' },
        { name: 'Recurring tasks', value: '`/recurring add` · `/recurring list` · `/recurring delete`' },
        { name: 'Settings', value: '`/settings timezone` · `/settings reminders` · `/settings digest`' },
        {
          name: 'Tips',
          value:
            'Dates understand plain English: "tomorrow 3pm", "next fri", "nov 20".\n' +
            'For update/delete/complete, start typing and pick from the suggestions.',
        },
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
