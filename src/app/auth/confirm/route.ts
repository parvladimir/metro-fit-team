import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RECOVERY_PATH, safeRecoveryNext } from '@/lib/recovery';

/**
 * Token-hash verification for password recovery e-mails. The token is checked
 * server-side with verifyOtp, so no PKCE verifier from the requesting browser
 * is needed — the link works on any device / in any mail app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeRecoveryNext(searchParams.get('next'));
  const failed = NextResponse.redirect(`${origin}${RECOVERY_PATH}?fehler=1`);

  if (type !== 'recovery' || !tokenHash || tokenHash.length > 256) return failed;

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) return failed;

  return NextResponse.redirect(`${origin}${next}`);
}
