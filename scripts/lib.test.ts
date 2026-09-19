import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeSeedTarget } from './lib';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('assertSafeSeedTarget', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])('allows local Supabase at %s', (url) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    expect(() => assertSafeSeedTarget()).not.toThrow();
  });

  it('rejects a remote project by default', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://production.supabase.co';
    delete process.env.ALLOW_REMOTE_DEV_SEED;
    expect(() => assertSafeSeedTarget()).toThrow(/Refusing to seed non-local Supabase/);
  });

  it('allows an explicitly disposable remote DEV project', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://disposable-dev.supabase.co';
    process.env.ALLOW_REMOTE_DEV_SEED = 'true';
    Reflect.set(process.env, 'NODE_ENV', 'test');
    Reflect.deleteProperty(process.env, 'VERCEL_ENV');
    expect(() => assertSafeSeedTarget()).not.toThrow();
  });

  it('never allows the production Vercel environment', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://production.supabase.co';
    process.env.ALLOW_REMOTE_DEV_SEED = 'true';
    Reflect.set(process.env, 'VERCEL_ENV', 'production');
    expect(() => assertSafeSeedTarget()).toThrow(/Refusing to seed non-local Supabase/);
  });
});
