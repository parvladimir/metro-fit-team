import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) config({ path: file });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

export function getAdminClient() {
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Demo seeding uses the service-role key and can create or update many rows.
 * Refuse remote targets unless the operator explicitly opts into a disposable
 * remote DEV project. Production Vercel environments can never bypass this.
 */
export function assertSafeSeedTarget() {
  const rawUrl = required('NEXT_PUBLIC_SUPABASE_URL');
  let hostname: string;

  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  }

  const isLocal = ['127.0.0.1', 'localhost', 'host.docker.internal'].includes(hostname);
  if (isLocal) return;

  const explicitlyAllowed = process.env.ALLOW_REMOTE_DEV_SEED === 'true';
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  if (explicitlyAllowed && !isProduction) return;

  throw new Error(
    `Refusing to seed non-local Supabase host "${hostname}". ` +
      'Use the local DEV setup, or set ALLOW_REMOTE_DEV_SEED=true only for a disposable remote DEV project.'
  );
}

export function getEnv() {
  return {
    initialAdminEmail: (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase(),
    initialTeamName: process.env.INITIAL_TEAM_NAME || 'Fitness Team',
    demoUserPassword: process.env.DEMO_USER_PASSWORD || null,
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
