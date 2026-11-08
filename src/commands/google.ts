import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { deleteUserData, getUser, listRecurring } from '../db';
import { completeLink, createAuthUrl, disconnectGoogle } from '../google/auth';
import { unscheduleUser } from '../scheduler';
import { describeCron } from '../schedule';
import { BRAND_COLOR } from '../util';
import { baseCommand, type Command, type ComponentHandler } from './types';

const PASTE_BUTTON = 'google:paste';
const PASTE_MODAL = 'google:modal';
const PASTE_FIELD = 'redirect_url';

export const googleCommand: Command = {
  data: baseCommand('google', 'Connect or disconnect your Google account')
    .addSubcommand((s) => s.setName('connect').setDescription('Link your Google Tasks and Google Calendar'))
    .addSubcommand((s) => s.setName('status').setDescription('Show your connection and settings'))
    .addSubcommand((s) =>
      s
        .setName('disconnect')
        .setDescription("Unlink Google and revoke Carla's access")
        .addBooleanOption((o) =>
          o.setName('delete_data').setDescription('Also delete your settings and recurring tasks from Carla'),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;

    if (sub === 'connect') {
      const url = createAuthUrl(discordId);
      const steps = [
        '**Link your Google account**',
        '1. Click **Sign in with Google** and allow access to Tasks and Calendar.',
        "2. Google then sends you to a `localhost` page that won't load. That's expected.",
        "3. Copy the **whole link** from your browser's address bar, click **Paste link**, and paste it.",
        '',
        '_The sign-in link expires in 15 minutes._',
      ];
      const paste = new ButtonBuilder().setCustomId(PASTE_BUTTON).setLabel('Paste link').setStyle(ButtonStyle.Primary);

      // Discord link buttons allow URLs up to 512 characters; fall back to a plain link if longer.
      if (url.length <= 512) {
        const signIn = new ButtonBuilder().setLabel('Sign in with Google').setStyle(ButtonStyle.Link).setURL(url);
        await interaction.editReply({
          content: steps.join('\n'),
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(signIn, paste)],
        });
      } else {
        await interaction.editReply({
          content: `${steps.join('\n')}\n\n[Sign in with Google](${url})`,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(paste)],
        });
      }
      return;
    }

    if (sub === 'status') {
      const user = getUser(discordId);
      const jobs = user ? listRecurring(discordId) : [];
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('Carla status')
        .addFields(
          { name: 'Google', value: user?.refresh_token_enc ? '✅ Connected' : '❌ Not connected', inline: true },
          { name: 'Timezone', value: user?.timezone ?? 'not set', inline: true },
          {
            name: 'Event reminders',
            value: user?.reminder_minutes ? `${user.reminder_minutes} min before` : 'off',
            inline: true,
          },
          { name: 'Daily digest', value: user?.digest_time ?? 'off', inline: true },
          {
            name: `Recurring tasks (${jobs.length})`,
            value: jobs.length ? jobs.map((j) => `#${j.id} ${j.title} — ${describeCron(j.cron_expr)}`).join('\n').slice(0, 1024) : 'none',
          },
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'disconnect') {
      const deleteData = interaction.options.getBoolean('delete_data') ?? false;
      await disconnectGoogle(discordId);
      unscheduleUser(discordId);
      if (deleteData) deleteUserData(discordId);
      await interaction.editReply(
        deleteData
          ? '🗑️ Disconnected and deleted everything Carla stored about you.'
          : '🔌 Disconnected. Your settings and recurring tasks are kept (paused) until you reconnect.',
      );
    }
  },
};

export const googleComponents: ComponentHandler = {
  prefix: 'google:',

  async handleButton(interaction) {
    if (interaction.customId !== PASTE_BUTTON) return;
    const input = new TextInputBuilder()
      .setCustomId(PASTE_FIELD)
      .setLabel('Paste the full localhost link')
      .setPlaceholder('http://localhost/?state=...&code=...&scope=...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);
    const modal = new ModalBuilder()
      .setCustomId(PASTE_MODAL)
      .setTitle('Finish linking Google')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (interaction.customId !== PASTE_MODAL) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeLink(interaction.user.id, interaction.fields.getTextInputValue(PASTE_FIELD));
    const user = getUser(interaction.user.id);
    await interaction.editReply(
      `✅ Google connected! Your timezone is **${user?.timezone}** (change it with \`/settings timezone\`).\n` +
        'Try `/tasks add`, `/calendar list`, or `/help`.',
    );
  },
};
