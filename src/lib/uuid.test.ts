import { afterEach, describe, expect, it, vi } from 'vitest';
import { newUuid, UUID_PATTERN } from './uuid';

afterEach(() => vi.unstubAllGlobals());

describe('newUuid', () => {
  it('uses crypto.randomUUID when it exists', () => {
    expect(newUuid()).toMatch(UUID_PATTERN);
  });

  it('still produces a valid v4 id on an insecure origin (no randomUUID)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xab) });
    const id = newUuid();
    expect(id).toMatch(UUID_PATTERN);
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('and without any crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newUuid()).toMatch(UUID_PATTERN);
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 200 }, newUuid)).size).toBe(200);
  });
});
