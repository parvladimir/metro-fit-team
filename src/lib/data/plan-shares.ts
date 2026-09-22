import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PlanShare, PlanShareItem } from '@/types/database';

export interface PlanShareWithItems extends PlanShare {
  authorName: string;
  items: PlanShareItem[];
}

interface ShareRow extends PlanShare {
  plan_share_items: PlanShareItem[];
  profiles: { full_name: string | null } | null;
}

function withAuthorAndItems(row: ShareRow): PlanShareWithItems {
  const { plan_share_items, profiles, ...share } = row;
  return {
    ...share,
    authorName: profiles?.full_name?.trim() || 'Ein Teammitglied',
    items: [...plan_share_items].sort((a, b) => a.position - b.position),
  };
}

/** Batched — one query per page load, like getQuotes/getMessageMentions. Only
 * messages that are actually a share get an entry in the result. */
export async function getPlanShares(messageIds: string[]): Promise<Record<string, PlanShareWithItems>> {
  if (messageIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_shares')
    .select('*, plan_share_items(*), profiles(full_name)')
    .in('message_id', messageIds);

  const out: Record<string, PlanShareWithItems> = {};
  for (const row of (data ?? []) as unknown as ShareRow[]) {
    out[row.message_id] = withAuthorAndItems(row);
  }
  return out;
}

export interface PlanShareForViewer extends PlanShareWithItems {
  savedTemplateId: string | null;
}

/** getPlanShares + "did I already save this" in one call — what the chat page needs per page load. */
export async function getPlanSharesForViewer(messageIds: string[], viewerId: string): Promise<Record<string, PlanShareForViewer>> {
  const shares = await getPlanShares(messageIds);
  const ids = Object.values(shares).map((s) => s.id);
  const saved = await getMyShareImports(ids, viewerId);
  const out: Record<string, PlanShareForViewer> = {};
  for (const [messageId, share] of Object.entries(shares)) {
    out[messageId] = { ...share, savedTemplateId: saved[share.id] ?? null };
  }
  return out;
}

export async function getPlanShare(shareId: string): Promise<PlanShareWithItems | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_shares')
    .select('*, plan_share_items(*), profiles(full_name)')
    .eq('id', shareId)
    .maybeSingle();
  if (!data) return null;
  return withAuthorAndItems(data as unknown as ShareRow);
}

/** Batched "already saved by me" lookup — a share only counts as saved while
 * a live (non-deleted) plan_templates row from it still exists. */
export async function getMyShareImports(shareIds: string[], userId: string): Promise<Record<string, string>> {
  if (shareIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_share_imports')
    .select('share_id, template_id, created_at, plan_templates(id)')
    .in('share_id', shareIds)
    .eq('recipient_id', userId)
    .not('template_id', 'is', null)
    .order('created_at', { ascending: false });

  const out: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as { share_id: string; template_id: string; plan_templates: { id: string } | null }[]) {
    if (row.plan_templates && !out[row.share_id]) out[row.share_id] = row.template_id;
  }
  return out;
}

export interface TeamShareListItem extends PlanShareWithItems {
  savedTemplateId: string | null;
}

/** "Geteilte Vorlagen": active (non-withdrawn) shares for a team, newest first. */
export async function getTeamShares(
  teamId: string,
  viewerId: string,
  opts: { search?: string; exerciseType?: string } = {},
): Promise<TeamShareListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('plan_shares')
    .select('*, plan_share_items(*), profiles(full_name)')
    .eq('team_id', teamId)
    .is('withdrawn_at', null)
    .order('created_at', { ascending: false });

  if (opts.search?.trim()) query = query.ilike('title', `%${opts.search.trim()}%`);

  const { data } = await query;
  let shares = ((data ?? []) as unknown as ShareRow[]).map(withAuthorAndItems);

  if (opts.exerciseType) {
    const type = opts.exerciseType;
    shares = shares.filter((s) => s.items.some((i) => i.exercise_type === type));
  }

  const saved = await getMyShareImports(shares.map((s) => s.id), viewerId);
  return shares.map((s) => ({ ...s, savedTemplateId: saved[s.id] ?? null }));
}
