import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { PENDING_INVITE_COOKIE, PENDING_INVITE_COOKIE_OPTIONS, extractInviteTokenFromPath } from '@/lib/pending-invite';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC_PATHS = [
  '/anmelden',
  '/registrieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
  '/auth/callback',
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p)) || path.startsWith('/beitreten');

  const inviteToken = extractInviteTokenFromPath(path);
  if (inviteToken) {
    if (!user) {
      // Stash the invite token in a short-lived cookie so it survives the
      // full registration/email-confirmation/login round trip even if the
      // `next` query param gets lost somewhere along the way. Set here
      // (not in the page component) because only middleware/route
      // handlers/server actions are allowed to write response cookies —
      // a plain Server Component render cannot.
      response.cookies.set(PENDING_INVITE_COOKIE, inviteToken, PENDING_INVITE_COOKIE_OPTIONS);
    } else {
      // The user reached the invite page authenticated — the cookie's job
      // (surviving the auth handoff) is done, whether or not they actually
      // confirm on this visit.
      response.cookies.delete(PENDING_INVITE_COOKIE);
    }
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/anmelden';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && (path === '/anmelden' || path === '/registrieren')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
