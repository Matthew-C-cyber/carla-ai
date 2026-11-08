import { EmbedBuilder } from 'discord.js';
import { config } from '../config';
import { getStats } from '../db';
import { UserFacingError } from '../errors';
import { BRAND_COLOR } from '../util';
import { baseCommand, type Command } from './types';

/** Owner-only usage numbers (handy for the resume bullet). Stats are pseudonymous: no message content. */
export const statsCommand: Command = {
  data: baseCommand('stats', 'Usage statistics (bot owner only)'),

  async execute(interaction) {
    if (!config.ownerId || interaction.user.id !== config.ownerId) {
      throw new UserFacingError('Only the bot owner can use `/stats`.');
    }
    const s = getStats();
    const uptimeHours = (process.uptime() / 3600).toFixed(1);
    const top = s.topCommands.map((c) => `\`/${c.name}\` × ${c.n}`).join('\n') || 'none yet';

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('📊 Carla usage')
      .addFields(
        { name: 'Servers', value: String(interaction.client.guilds.cache.size), inline: true },
        { name: 'Linked Google accounts', value: String(s.linkedUsers), inline: true },
        { name: 'Users (all time / 30d)', value: `${s.usersEver} / ${s.activeUsers30d}`, inline: true },
        { name: 'Commands (all time / 30d)', value: `${s.commandsTotal} / ${s.commands30d}`, inline: true },
        { name: 'Active recurring tasks', value: String(s.recurringJobs), inline: true },
        { name: 'Automated runs (cron)', value: String(s.automatedRuns), inline: true },
        { name: 'Top commands', value: top },
      )
      .setFooter({ text: `Process uptime: ${uptimeHours} h` });
    await interaction.editReply({ embeds: [embed] });
  },
};
