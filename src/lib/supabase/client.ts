'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Browser Supabase client. Uses only the public URL + anon key, which are
 * safe to ship to the client — every privileged operation is enforced by
 * Postgres Row Level Security, not by keeping this client "trusted".
 */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
