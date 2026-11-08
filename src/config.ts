import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildId: optional('DISCORD_GUILD_ID'),
  ownerId: optional('OWNER_ID'),
  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: optional('GOOGLE_REDIRECT_URI') ?? 'http://localhost',
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY'),
  databasePath: optional('DATABASE_PATH') ?? './data/carla.db',
  defaultTimezone: optional('DEFAULT_TIMEZONE') ?? 'America/New_York',
};

if (!/^[0-9a-fA-F]{64}$/.test(config.tokenEncryptionKey)) {
  throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
}
