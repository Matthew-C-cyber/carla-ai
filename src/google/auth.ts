import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { config } from '../config';
import { decrypt, encrypt } from '../crypto';
import { clearRefreshToken, consumeOAuthState, getUser, saveLink, saveOAuthState } from '../db';
import { NotLinkedError, UserFacingError } from '../errors';

export const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
];

export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

const STATE_TTL_MS = 15 * 60 * 1000;
const clients = new Map<string, OAuthClient>();

function newClient(): OAuthClient {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

/** Step 1: a Google consent URL tied to this Discord user by a one-time `state` value. */
export function createAuthUrl(discordId: string): string {
  const state = randomBytes(24).toString('hex');
  saveOAuthState(state, discordId, STATE_TTL_MS);
  return newClient().generateAuthUrl({
    access_type: 'offline', // we need a refresh token for background jobs
    prompt: 'consent', // always return a refresh token, even on re-link
    scope: SCOPES,
    state,
  });
}

/** Pulls `code` and `state` out of the localhost URL the user copied from their address bar. */
export function parseRedirect(input: string): { code: string; state: string } {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `http://localhost/${text.replace(/^[/?]+/, '?')}`);
  } catch {
    throw new UserFacingError('That does not look like the link from your address bar. Copy the whole thing and try again.');
  }
  const error = url.searchParams.get('error');
  if (error) throw new UserFacingError(`Google returned "${error}". Run \`/google connect\` to try again.`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    throw new UserFacingError(
      'Paste the **whole** address-bar link (it starts with `http://localhost` and contains `code=` and `state=`).',
    );
  }
  return { code, state };
}

/** Step 2: exchange the code for tokens and store the refresh token encrypted. */
export async function completeLink(discordId: string, pasted: string): Promise<void> {
  const { code, state } = parseRedirect(pasted);
  if (consumeOAuthState(state) !== discordId) {
    throw new UserFacingError('That link expired or was started by someone else. Run `/google connect` again.');
  }

  let tokens;
  try {
    ({ tokens } = await newClient().getToken(code));
  } catch {
    throw new UserFacingError('Google rejected that code (codes work once and expire quickly). Run `/google connect` again.');
  }

  if (!tokens.refresh_token) {
    throw new UserFacingError(
      'Google did not send a refresh token. Remove Carla at https://myaccount.google.com/permissions, then run `/google connect` again.',
    );
  }
  const granted = (tokens.scope ?? '').split(' ');
  if (SCOPES.some((scope) => !granted.includes(scope))) {
    throw new UserFacingError('Carla needs both Google Tasks and Google Calendar access. Run `/google connect` again and tick both boxes.');
  }

  saveLink(discordId, encrypt(tokens.refresh_token));
  clients.delete(discordId);
}

/** An authorized client for this user. Cached so access tokens are reused until they expire. */
export function getAuthClient(discordId: string): OAuthClient {
  const cached = clients.get(discordId);
  if (cached) return cached;

  const user = getUser(discordId);
  if (!user?.refresh_token_enc) throw new NotLinkedError();

  let refreshToken: string;
  try {
    refreshToken = decrypt(user.refresh_token_enc);
  } catch {
    // Encryption key changed: the stored token is unreadable, so the user has to re-link.
    clearRefreshToken(discordId);
    throw new NotLinkedError();
  }

  const client = newClient();
  client.setCredentials({ refresh_token: refreshToken });
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) saveLink(discordId, encrypt(tokens.refresh_token));
  });
  clients.set(discordId, client);
  return client;
}

function httpStatus(err: unknown): number | undefined {
  const e = err as { response?: { status?: number }; status?: number };
  return e?.response?.status ?? e?.status;
}

function isInvalidGrant(err: unknown): boolean {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error === 'invalid_grant' || /invalid_grant/.test(e?.message ?? '');
}

/** Run a Google API call for a user and turn common Google failures into friendly messages. */
export async function withGoogle<T>(discordId: string, fn: (auth: OAuthClient) => Promise<T>): Promise<T> {
  const auth = getAuthClient(discordId);
  try {
    return await fn(auth);
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    if (isInvalidGrant(err)) {
      clearRefreshToken(discordId);
      clients.delete(discordId);
      throw new UserFacingError('Your Google connection expired or was revoked. Run `/google connect` to reconnect.');
    }
    switch (httpStatus(err)) {
      case 404:
      case 410:
        throw new UserFacingError("That item doesn't exist anymore (it may have been deleted in Google).");
      case 403:
        throw new UserFacingError('Google refused that request. If you unticked a permission when connecting, run `/google connect` again.');
      case 429:
        throw new UserFacingError('Google is rate-limiting requests right now. Try again in a minute.');
      default:
        throw err;
    }
  }
}

/** Revoke Carla's access at Google (best effort) and forget the token locally. */
export async function disconnectGoogle(discordId: string): Promise<void> {
  const user = getUser(discordId);
  if (user?.refresh_token_enc) {
    try {
      await newClient().revokeToken(decrypt(user.refresh_token_enc));
    } catch {
      // Already revoked or unreadable: nothing else to do at Google's end.
    }
  }
  clearRefreshToken(discordId);
  clients.delete(discordId);
}
