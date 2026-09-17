import { describe, expect, it } from 'vitest';
import { resolveAuthorName, FORMER_MEMBER_LABEL } from './chat-identity';

describe('resolveAuthorName', () => {
  it('returns the "former member" label when the profile is not resolvable (RLS-hidden or gone)', () => {
    expect(resolveAuthorName(null)).toBe(FORMER_MEMBER_LABEL);
  });

  it('returns the real name when the profile is resolvable and has a name', () => {
    expect(resolveAuthorName({ full_name: 'Tim A' })).toBe('Tim A');
  });

  it('falls back to a generic label only for an accessible profile with no name set', () => {
    expect(resolveAuthorName({ full_name: '' })).toBe('Mitglied');
    expect(resolveAuthorName({ full_name: null })).toBe('Mitglied');
  });
});
