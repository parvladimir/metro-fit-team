import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildRecoveryUrl, hashEmail, isPlausibleEmail, isRecoveryNext, isSafeInternalPath, safeRecoveryNext } from './recovery';
import { buildRecoveryEmail } from './server/mail';

describe('safe next', () => {
  it('recovery links always resolve to the reset page (no open redirect)', () => {
    for (const evil of ['https://evil.com', '//evil.com', '/\\evil', 'javascript:alert(1)', '/team', '', null, undefined]) {
      expect(safeRecoveryNext(evil as never)).toBe('/passwort-zuruecksetzen');
    }
  });
  it('isSafeInternalPath rejects external/protocol-relative', () => {
    expect(isSafeInternalPath('/team')).toBe(true);
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', '/javascript:x', 'team', '']) expect(isSafeInternalPath(bad)).toBe(false);
  });
  it('isRecoveryNext', () => {
    expect(isRecoveryNext('/passwort-zuruecksetzen')).toBe(true);
    expect(isRecoveryNext('/passwort-zuruecksetzen?x=1')).toBe(true);
    expect(isRecoveryNext('/anmelden')).toBe(false);
  });
});

describe('recovery url + email', () => {
  it('builds the production confirm url', () => {
    expect(buildRecoveryUrl('https://metro-fit-team.vercel.app/', 'abc123', true)).toBe(
      'https://metro-fit-team.vercel.app/auth/confirm?token_hash=abc123&type=recovery&next=%2Fpasswort-zuruecksetzen',
    );
  });
  it('refuses localhost / http in production', () => {
    expect(() => buildRecoveryUrl('http://localhost:3000', 't', true)).toThrow();
    expect(() => buildRecoveryUrl('http://x.de', 't', true)).toThrow();
    expect(buildRecoveryUrl('http://localhost:3000', 't', false)).toContain('localhost');
  });
  it('email contains link, German text, no secrets', () => {
    const m = buildRecoveryEmail('https://metro-fit-team.vercel.app/auth/confirm?token_hash=x&type=recovery');
    expect(m.subject).toContain('Passwort');
    expect(m.text).toContain('/auth/confirm?token_hash=x');
    expect(m.html).toContain('Neues Passwort festlegen');
  });
});

describe('email helpers', () => {
  it('validates and hashes case-insensitively', () => {
    expect(isPlausibleEmail('a@b.de')).toBe(true);
    expect(isPlausibleEmail('nope')).toBe(false);
    expect(hashEmail(' A@B.de ')).toBe(hashEmail('a@b.de'));
    expect(hashEmail('a@b.de')).not.toContain('@');
  });
});

// ---- route + action behaviour with a mocked Supabase server client ----
const verifyOtp = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const resetPasswordForEmail = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const waitUntilMock = vi.fn();
const sendRecoveryEmail = vi.fn(async (_email: string) => {});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp, getUser, updateUser, signOut, resetPasswordForEmail, exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: { message: 'x' } }) } }),
}));
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => waitUntilMock(p) }));
vi.mock('@/lib/server/recovery-mail', () => ({ sendRecoveryEmail: (e: string) => sendRecoveryEmail(e) }));
vi.mock('@/lib/server/bootstrap', () => ({ ensureInitialAdminBootstrap: vi.fn() }));
vi.mock('@/lib/env', () => ({ publicEnv: { appUrl: 'https://metro-fit-team.vercel.app', supabaseUrl: 'u', supabaseAnonKey: 'k' } }));

const req = (url: string) => ({ url }) as never;

describe('GET /auth/confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valid recovery token → verifyOtp → reset page', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { GET } = await import('@/app/auth/confirm/route');
    const res = await GET(req('https://metro-fit-team.vercel.app/auth/confirm?token_hash=abc&type=recovery&next=/passwort-zuruecksetzen'));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' });
    expect(res.headers.get('location')).toBe('https://metro-fit-team.vercel.app/passwort-zuruecksetzen');
  });

  it('ignores an external next parameter', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { GET } = await import('@/app/auth/confirm/route');
    const res = await GET(req('https://metro-fit-team.vercel.app/auth/confirm?token_hash=abc&type=recovery&next=https://evil.com'));
    expect(res.headers.get('location')).toBe('https://metro-fit-team.vercel.app/passwort-zuruecksetzen');
  });

  it.each([
    ['expired/used token', 'token_hash=abc&type=recovery', { error: { message: 'Token has expired or is invalid' } }],
    ['malformed token', 'token_hash=%%%&type=recovery', { error: { message: 'bad' } }],
  ])('%s → friendly error page', async (_n, qs, result) => {
    verifyOtp.mockResolvedValue(result);
    const { GET } = await import('@/app/auth/confirm/route');
    const res = await GET(req(`https://metro-fit-team.vercel.app/auth/confirm?${qs}`));
    expect(res.headers.get('location')).toBe('https://metro-fit-team.vercel.app/passwort-zuruecksetzen?fehler=1');
  });

  it.each(['type=recovery', 'token_hash=abc', 'token_hash=abc&type=signup', 'token_hash=abc&type=magiclink'])('missing token / wrong type (%s) → error, no verify', async (qs) => {
    const { GET } = await import('@/app/auth/confirm/route');
    const res = await GET(req(`https://metro-fit-team.vercel.app/auth/confirm?${qs}`));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('fehler=1');
  });
});

describe('GET /auth/callback for recovery', () => {
  it('failed/missing code on a recovery link → reset page error, not /anmelden', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    const cookies = { get: () => undefined };
    for (const url of [
      'https://metro-fit-team.vercel.app/auth/callback?next=/passwort-zuruecksetzen',
      'https://metro-fit-team.vercel.app/auth/callback?code=bad&next=/passwort-zuruecksetzen',
    ]) {
      const res = await GET({ url, cookies } as never);
      expect(res.headers.get('location')).toBe('https://metro-fit-team.vercel.app/passwort-zuruecksetzen?fehler=1');
    }
  });
});

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('resetPasswordAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no recovery session → cannot change password', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { resetPasswordAction } = await import('@/app/(auth)/actions');
    const r = await resetPasswordAction(undefined, fd({ password: 'newpass123', confirmPassword: 'newpass123' }));
    expect(r?.error).toContain('ungültig oder abgelaufen');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('validates length and match', async () => {
    const { resetPasswordAction } = await import('@/app/(auth)/actions');
    expect((await resetPasswordAction(undefined, fd({ password: 'short', confirmPassword: 'short' })))?.error).toContain('8 Zeichen');
    expect((await resetPasswordAction(undefined, fd({ password: 'newpass123', confirmPassword: 'other1234' })))?.error).toContain('stimmen nicht überein');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('valid session → updates, signs out recovery session, redirects to login notice', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    updateUser.mockResolvedValue({ error: null });
    const { resetPasswordAction } = await import('@/app/(auth)/actions');
    await expect(resetPasswordAction(undefined, fd({ password: 'newpass123', confirmPassword: 'newpass123' }))).rejects.toThrow('REDIRECT:/anmelden?passwort=geaendert');
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(signOut).toHaveBeenCalled();
  });
});

describe('forgotPasswordAction (no enumeration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_USER = 'x@gmail.com';
    process.env.SMTP_PASS = 'abcdabcdabcdabcd';
  });

  it('returns the identical message for any address and never errors', async () => {
    const { forgotPasswordAction } = await import('@/app/(auth)/actions');
    const a = await forgotPasswordAction(undefined, fd({ email: 'exists@example.com' }));
    const b = await forgotPasswordAction(undefined, fd({ email: 'ghost@example.com' }));
    const c = await forgotPasswordAction(undefined, fd({ email: 'not-an-email' }));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a?.success).toBe('Wenn ein Konto mit dieser E-Mail existiert, haben wir dir einen Link geschickt.');
    expect(waitUntilMock).toHaveBeenCalledTimes(2);
  });
});
