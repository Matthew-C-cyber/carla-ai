/**
 * Registers the slash commands with Discord. Run once after setup and again whenever
 * command names or options change:  npm run register
 */
import { REST, Routes } from 'discord.js';
import { commands } from './commands';
import { config } from './config';

async function main(): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  await rest.put(route, { body });
  console.log(
    config.discordGuildId
      ? `Registered ${body.length} commands to server ${config.discordGuildId} (available immediately).`
      : `Registered ${body.length} global commands (restart Discord if they don't show up right away).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to register commands:', err);
    process.exit(1);
  });
