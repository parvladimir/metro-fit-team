import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';
import { buildRecoveryEmail, sendMail } from '@/lib/server/mail';
import { RECOVERY_LIMITS, buildRecoveryUrl, hashEmail } from '@/lib/recovery';

/**
 * Generates a recovery token_hash with the admin API and mails our own
 * /auth/confirm link over SMTP. The token_hash is verified server-side
 * (verifyOtp), so it does NOT depend on a PKCE verifier stored in the
 * requesting browser — the link works from any device or mail app.
 *
 * Never throws and never reveals (to the caller's caller) whether the account
 * exists; tokens are never logged.
 */
export async function sendRecoveryEmail(email: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const hash = hashEmail(email);
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();

    const [minute, hour, global] = await Promise.all([
      admin.from('password_reset_requests').select('id', { count: 'exact', head: true }).eq('email_hash', hash).gte('requested_at', iso(60_000)),
      admin.from('password_reset_requests').select('id', { count: 'exact', head: true }).eq('email_hash', hash).gte('requested_at', iso(3_600_000)),
      admin.from('password_reset_requests').select('id', { count: 'exact', head: true }).gte('requested_at', iso(3_600_000)),
    ]);
    if (
      (minute.count ?? 0) >= RECOVERY_LIMITS.perEmailPerMinute ||
      (hour.count ?? 0) >= RECOVERY_LIMITS.perEmailPerHour ||
      (global.count ?? 0) >= RECOVERY_LIMITS.globalPerHour
    ) {
      return;
    }
    await admin.from('password_reset_requests').insert({ email_hash: hash });

    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) return; // unknown address: silently do nothing

    const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
    const link = buildRecoveryUrl(publicEnv.appUrl, tokenHash, isProd);
    await sendMail({ to: email, ...buildRecoveryEmail(link) });
  } catch (err) {
    console.error('[recovery] failed', err instanceof Error ? err.message.slice(0, 120) : 'unknown');
  }
}
