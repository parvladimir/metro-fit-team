import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv, getServerEnv } from '@/lib/env';

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * SECURITY: `server-only` import above makes bundling this into any client
 * component a BUILD ERROR, not just a lint warning. Only import this from
 * route handlers / server actions that specifically need privileged access
 * (bootstrap, invite-link generation with elevated lookups, admin scripts).
 * Never pass this client's results directly back to the browser without
 * re-checking authorization — it does not know about the current user.
 */
export function createAdminClient() {
  const { supabaseServiceRoleKey } = getServerEnv();
  return createSupabaseClient(publicEnv.supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
