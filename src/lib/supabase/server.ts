import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server Supabase client for use in Server Components, Server Actions, and
 * Route Handlers. Runs with the caller's own session (from cookies), so
 * every query is still subject to Row Level Security — this is NOT a
 * privileged client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component that cannot set cookies — the
          // middleware's session refresh already handles this case.
        }
      },
    },
  });
}
