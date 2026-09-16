import { publicEnv } from '@/lib/env';

/**
 * Central place for configurable branding. Never hardcode "METRO" anywhere
 * else in the codebase — always read it from here (which reads env vars).
 */
export const appConfig = {
  name: publicEnv.appName,
  url: publicEnv.appUrl,
  defaultLocale: publicEnv.defaultLocale,
};

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const; // 1 = Montag ... 7 = Sonntag
