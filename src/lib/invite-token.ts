import 'server-only';
import { randomBytes, createHash } from 'node:crypto';

/** Generates a URL-safe random invite token and its SHA-256 hash (hex). */
export function generateInviteToken() {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}
