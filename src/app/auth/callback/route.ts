import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureInitialAdminBootstrap } from '@/lib/server/bootstrap';
import { PENDING_INVITE_COOKIE, resolveEffectiveNext } from '@/lib/pending-invite';
import { RECOVERY_PATH, isRecoveryNext } from '@/lib/recovery';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';
  const pendingInviteToken = request.cookies.get(PENDING_INVITE_COOKIE)?.value;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      await ensureInitialAdminBootstrap(data.user.id, data.user.email);
      const effectiveNext = resolveEffectiveNext(next, pendingInviteToken);
      const response = NextResponse.redirect(`${origin}${effectiveNext}`);
      // The invite has now safely reached an authenticated destination — the
      // cookie's job is done regardless of which source (query param or
      // cookie) actually supplied it.
      response.cookies.delete(PENDING_INVITE_COOKIE);
      return response;
    }
  }

  // A failed password-recovery link (expired, opened on another device without
  // the PKCE verifier, tokens in the URL fragment…) gets a proper explanation
  // instead of a silent bounce to the login page.
  if (isRecoveryNext(next)) return NextResponse.redirect(`${origin}${RECOVERY_PATH}?fehler=1`);

  return NextResponse.redirect(`${origin}/anmelden`);
}
