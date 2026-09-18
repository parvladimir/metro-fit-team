import { createHash } from 'node:crypto';

export const RECOVERY_PATH = '/passwort-zuruecksetzen';

/**
 * Recovery links may only ever land on the reset page. Anything else
 * (external URLs, protocol-relative, other app paths) is discarded — this is
 * what prevents /auth/confirm from being used as an open redirect.
 */
export function safeRecoveryNext(_next: string | null | undefined): string {
  return RECOVERY_PATH;
}

/** True only for a same-origin absolute path (no scheme, no `//`, no backslash). */
export function isSafeInternalPath(next: string | null | undefined): next is string {
  return !!next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/^\/[a-z][a-z0-9+.-]*:/i.test(next);
}

export function isRecoveryNext(next: string | null | undefined): boolean {
  return !!next && next.split(/[?#]/)[0] === RECOVERY_PATH;
}

export function buildRecoveryUrl(appUrl: string, tokenHash: string, isProduction: boolean): string {
  const base = appUrl.replace(/\/+$/, '');
  if (isProduction && (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base))) {
    throw new Error('invalid_production_app_url');
  }
  return `${base}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=${encodeURIComponent(RECOVERY_PATH)}`;
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export const RECOVERY_LIMITS = { perEmailPerMinute: 1, perEmailPerHour: 5, globalPerHour: 60 };

export const RECOVERY_REQUEST_MESSAGE = 'Wenn ein Konto mit dieser E-Mail existiert, haben wir dir einen Link geschickt.';
export const RECOVERY_INVALID_MESSAGE = 'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen.';
