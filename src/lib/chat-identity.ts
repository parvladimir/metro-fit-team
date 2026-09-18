// Pure helper, deliberately kept out of any 'server-only' module so it can
// be unit-tested directly (see chat-identity.test.ts).
//
// RLS on `profiles` only lets a viewer resolve a profile that still shares a
// team with them (see profiles_select_own_or_teammate) — so a historical
// chat message from someone no longer on the team resolves `profiles: null`
// here, not because the profile was deleted, but because they're no longer
// a visible teammate. "Mitglied" (generic placeholder) is reserved for the
// separate, genuinely-rare case of an accessible profile with no name set.
export const FORMER_MEMBER_LABEL = 'Ehemaliges Mitglied';
const GENERIC_MEMBER_LABEL = 'Mitglied';

export function resolveAuthorName(profile: { full_name: string | null } | null): string {
  if (profile === null) return FORMER_MEMBER_LABEL;
  return profile.full_name || GENERIC_MEMBER_LABEL;
}
