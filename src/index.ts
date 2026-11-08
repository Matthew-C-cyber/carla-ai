import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { commands, componentHandlers } from './commands';
import { config } from './config';
import { db, logActivity } from './db';
import { UserFacingError } from './errors';
import { startScheduler } from './scheduler';

// Slash commands only need the Guilds intent (no message content, no privileged intents).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commandMap = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, (ready) => {
  console.log(`Logged in as ${ready.user.tag} in ${ready.guilds.cache.size} server(s)`);
  startScheduler(ready);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      // Google calls can take longer than Discord's 3 s limit, so defer first. Replies are private.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await command.execute(interaction);
      const sub = interaction.options.getSubcommand(false);
      logActivity(interaction.user.id, sub ? `${interaction.commandName} ${sub}` : interaction.commandName);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      try {
        await command?.autocomplete?.(interaction);
      } catch {
        // Not linked, Google hiccup, etc.: show an empty list rather than an error.
      }
      if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
      return;
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {
      const handler = componentHandlers.find((h) => interaction.customId.startsWith(h.prefix));
      if (interaction.isButton()) await handler?.handleButton?.(interaction);
      else await handler?.handleModal?.(interaction);
    }
  } catch (err) {
    await reportError(interaction, err);
  }
});

async function reportError(interaction: Interaction, err: unknown): Promise<void> {
  const friendly = err instanceof UserFacingError;
  if (!friendly) console.error('Unhandled interaction error:', err);
  if (!interaction.isRepliable()) return;

  const content = friendly ? `⚠️ ${err.message}` : '❌ Something went wrong on my end. Please try again in a moment.';
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, embeds: [], components: [] });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (replyErr) {
    console.error('Could not report error to user:', replyErr);
  }
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  void client.destroy();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

void client.login(config.discordToken);
