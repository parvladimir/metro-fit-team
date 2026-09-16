function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Public config — safe to import from client components. */
export const publicEnv = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'Fit Team',
  defaultLocale: (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as 'de' | 'en' | 'ru') || 'de',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
};

/**
 * Server-only config. Importing this file from a client component is a bug —
 * every value here is either secret (service role key) or only meaningful
 * on the server (bootstrap admin identity). Next.js will fail the build if
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` is referenced from client code
 * because it is not prefixed with NEXT_PUBLIC_, but we still isolate it here
 * so it can never be imported by accident from `src/app/**\/page.tsx` client
 * components — only from `route.ts` handlers, server actions, and scripts.
 */
export function getServerEnv() {
  return {
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    initialAdminEmail: (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase(),
    initialTeamName: process.env.INITIAL_TEAM_NAME || 'Fitness Team',
  };
}
