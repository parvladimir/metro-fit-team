import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile, TeamMember } from '@/types/database';

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Redirects to /anmelden if not authenticated — use at the top of protected pages. */
export async function requireAuthUser() {
  const user = await getAuthUser();
  if (!user) redirect('/anmelden');
  return user;
}

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return data as Profile | null;
});

export interface TeamMembership extends TeamMember {
  team_name: string;
  team_slug: string;
}

/** A member currently belongs to at most one active team in v1 (first membership wins). */
export const getPrimaryTeamMembership = cache(async (userId: string): Promise<TeamMembership | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_members')
    .select('*, teams(name, slug)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const teams = data.teams as unknown as { name: string; slug: string } | null;

  return {
    ...(data as TeamMember),
    team_name: teams?.name ?? '',
    team_slug: teams?.slug ?? '',
  };
});
