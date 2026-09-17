import { describe, expect, it } from 'vitest';
import { extractInviteTokenFromPath, isInviteNext, resolveEffectiveNext } from './pending-invite';

describe('extractInviteTokenFromPath', () => {
  it('extracts the token from a beitreten path', () => {
    expect(extractInviteTokenFromPath('/beitreten/abc123')).toBe('abc123');
  });

  it('extracts the token when trailing query/hash is present', () => {
    expect(extractInviteTokenFromPath('/beitreten/abc123?foo=bar')).toBe('abc123');
    expect(extractInviteTokenFromPath('/beitreten/abc123#section')).toBe('abc123');
  });

  it('returns null for non-invite paths', () => {
    expect(extractInviteTokenFromPath('/team')).toBeNull();
    expect(extractInviteTokenFromPath('/')).toBeNull();
    expect(extractInviteTokenFromPath('/beitreten/')).toBeNull();
  });
});

describe('isInviteNext', () => {
  it('is true only for values pointing at an invite', () => {
    expect(isInviteNext('/beitreten/abc123')).toBe(true);
    expect(isInviteNext('/team')).toBe(false);
    expect(isInviteNext(undefined)).toBe(false);
    expect(isInviteNext(null)).toBe(false);
    expect(isInviteNext('')).toBe(false);
  });
});

describe('resolveEffectiveNext', () => {
  it('prefers an invite-shaped next over the cookie', () => {
    expect(resolveEffectiveNext('/beitreten/from-next', 'from-cookie')).toBe('/beitreten/from-next');
  });

  it('falls back to the pending-invite cookie when next is not an invite', () => {
    expect(resolveEffectiveNext('/', 'from-cookie')).toBe('/beitreten/from-cookie');
    expect(resolveEffectiveNext(undefined, 'from-cookie')).toBe('/beitreten/from-cookie');
  });

  it('falls back to plain next (or /) when neither is an invite', () => {
    expect(resolveEffectiveNext('/team', undefined)).toBe('/team');
    expect(resolveEffectiveNext(undefined, undefined)).toBe('/');
  });

  it('URL-encodes a cookie token used to build the fallback path', () => {
    expect(resolveEffectiveNext(undefined, 'to k/en')).toBe('/beitreten/to%20k%2Fen');
  });
});
