import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getTeamRoster } from '@/lib/data/team';
import { duelPhase, type DuelPerson, type DuelStatus, type DuelView } from '@/lib/duels';

// Both profile embeds need an explicit FK hint: team_duels references
// profiles twice (inviter and invitee), so a bare `profiles(...)` is ambiguous.
const DUEL_SELECT =
  'id, team_id, inviter_id, invitee_id, target_days, starts_on, ends_on, expires_at, status, created_at, ' +
  'inviter:profiles!team_duels_inviter_id_fkey(id, full_name, avatar_url), ' +
  'invitee:profiles!team_duels_invitee_id_fkey(id, full_name, avatar_url)';

type ProfileEmbed = { id: string; full_name: string | null; avatar_url: string | null } | null;
interface DuelRow {
  id: string;
  team_id: string;
  inviter_id: string;
  invitee_id: string;
  target_days: number;
  starts_on: string;
  ends_on: string;
  expires_at: string;
  status: DuelStatus;
  inviter: ProfileEmbed;
  invitee: ProfileEmbed;
}

const person = (id: string, embed: ProfileEmbed): DuelPerson => ({
  id,
  name: embed?.full_name?.trim() || 'Teammitglied',
  avatarUrl: embed?.avatar_url ?? null,
});

function toDuelView(row: DuelRow, viewerId: string, now: Date): DuelView {
  const iAmInviter = row.inviter_id === viewerId;
  return {
    id: row.id,
    teamId: row.team_id,
    status: row.status,
    phase: duelPhase({ status: row.status, starts_on: row.starts_on, ends_on: row.ends_on, expires_at: row.expires_at }, now),
    role: iAmInviter ? 'inviter' : 'invitee',
    targetDays: row.target_days,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    expiresAt: row.expires_at,
    me: iAmInviter ? person(row.inviter_id, row.inviter) : person(row.invitee_id, row.invitee),
    other: iAmInviter ? person(row.invitee_id, row.invitee) : person(row.inviter_id, row.inviter),
    progress: null,
  };
}

/** The viewer's duels, newest first (row-level security already limits this to
 * duels they take part in whose other participant is still a team member).
 * Accepted duels that have begun carry both people's capped training-day
 * counts. Never throws: if the duel tables are missing (code deployed before
 * its migration) or a query fails, the answer is simply "no duels", so Home
 * and the team hub keep working. */
export async function getDuelsForViewer(viewerId: string, now: Date = new Date()): Promise<DuelView[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('team_duels').select(DUEL_SELECT).order('created_at', { ascending: false }).limit(25);
    if (error || !data) return [];

    const views = (data as unknown as DuelRow[]).map((row) => toDuelView(row, viewerId, now));
    await Promise.all(
      views
        .filter((v) => v.status === 'accepted' && v.phase !== 'upcoming')
        .map(async (v) => {
          const { data: counts, error: progressError } = await supabase.rpc('get_duel_progress', { p_duel_id: v.id });
          if (progressError || !counts) return;
          const byUser = new Map((counts as { participant_id: string; counted_days: number }[]).map((c) => [c.participant_id, Number(c.counted_days)]));
          if (byUser.has(v.me.id) && byUser.has(v.other.id)) {
            v.progress = { me: byUser.get(v.me.id)!, other: byUser.get(v.other.id)! };
          }
        })
    );
    return views;
  } catch {
    return [];
  }
}

/** Teammates the viewer could invite: every other current member. Whether one
 * of them is free is deliberately not revealed here — an invitation to
 * someone unavailable simply gets a neutral refusal from the database. */
export async function getInvitableTeammates(teamId: string, viewerId: string): Promise<DuelPerson[]> {
  const roster = await getTeamRoster(teamId);
  return roster
    .filter((m) => m.user_id !== viewerId)
    .map((m) => ({ id: m.user_id, name: m.profile?.full_name?.trim() || 'Teammitglied', avatarUrl: m.profile?.avatar_url ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
