/**
 * Shared constants for the "pending team invite" cookie — the safety net
 * that lets a logged-out user's invite survive the full auth flow
 * (registration, email confirmation, login) even if the `next` query
 * param gets lost somewhere along the way (e.g. an email gateway that
 * strips/rewrites URL query strings, a bookmarked /anmelden link, etc).
 *
 * The cookie holds ONLY the opaque raw invite token — the same value
 * already shared via the QR code/link, good for joining exactly one team
 * as a plain member. It carries no team_id, role, or user identity, so
 * there is nothing privileged to protect beyond what redeem_team_invite()
 * itself already validates server-side.
 *
 * Lifecycle: set by middleware the moment an unauthenticated visitor hits
 * /beitreten/<token>; read (and preferred over a generic `next`) by
 * signInAction, signUpAction's emailRedirectTo, and /auth/callback; cleared
 * by middleware the moment an authenticated user reaches /beitreten/<token>
 * again (its job is done at that point, redemption itself happens via the
 * confirmation screen there).
 */
export const PENDING_INVITE_COOKIE = 'pending_team_invite';
export const PENDING_INVITE_MAX_AGE_SECONDS = 30 * 60; // 30 minutes — long enough for email confirmation, short enough to not linger

export const PENDING_INVITE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: PENDING_INVITE_MAX_AGE_SECONDS,
};

const BEITRETEN_PATH_RE = /^\/beitreten\/([^/?#]+)/;

export function extractInviteTokenFromPath(pathname: string): string | null {
  const token = pathname.match(BEITRETEN_PATH_RE)?.[1];
  return token ? decodeURIComponent(token) : null;
}

/** True only for a `next` value that actually points back to an invite. */
export function isInviteNext(next: string | null | undefined): next is string {
  return !!next && BEITRETEN_PATH_RE.test(next);
}

/**
 * Picks where to send the user after auth: prefer an invite `next` if
 * present, otherwise fall back to the pending-invite cookie (in case the
 * query param got lost along the way), otherwise the plain `next`/default.
 */
export function resolveEffectiveNext(next: string | null | undefined, cookieToken: string | null | undefined): string {
  if (isInviteNext(next)) return next;
  if (cookieToken) return `/beitreten/${encodeURIComponent(cookieToken)}`;
  return next || '/';
}
