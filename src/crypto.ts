import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { config } from './config';

const key = Buffer.from(config.tokenEncryptionKey, 'hex');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** AES-256-GCM. Output layout (base64): iv | auth tag | ciphertext. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decrypt(payload: string): string {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Keyed hash so usage stats and logs can tell users apart without storing raw Discord IDs. */
export function pseudonym(discordId: string): string {
  return createHmac('sha256', key).update(discordId).digest('hex').slice(0, 16);
}
