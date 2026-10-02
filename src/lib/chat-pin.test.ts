import { describe, expect, it } from 'vitest';
import { PIN_SELECT, pinFromRow } from './chat-pin';

const row = (over: Record<string, unknown> = {}) => ({
  message_id: 'm-1',
  messages: { id: 'm-1', content: 'Aktuelle Infos zum **Wettbewerb**', message_type: 'text', deleted_at: null, parent_message_id: null, profiles: { full_name: 'Tim' }, ...over },
});

describe('pinFromRow', () => {
  it('shows the original message: author, plain-text preview (no markdown), not a photo', () => {
    expect(pinFromRow(row())).toEqual({ id: 'm-1', authorName: 'Tim', preview: 'Aktuelle Infos zum Wettbewerb', isImage: false, deleted: false });
  });

  it('an edited message shows its current text — nothing is copied into the pin', () => {
    expect(pinFromRow(row({ content: 'Neuer Text' }))?.preview).toBe('Neuer Text');
  });

  it('a photo is a photo, with its caption when there is one', () => {
    expect(pinFromRow(row({ message_type: 'image', content: '' }))).toMatchObject({ isImage: true, preview: '' });
    expect(pinFromRow(row({ message_type: 'image', content: 'Plan' }))).toMatchObject({ isImage: true, preview: 'Plan' });
  });

  it('long text is cut to a short preview', () => {
    const p = pinFromRow(row({ content: 'x'.repeat(500) }));
    expect(p!.preview.length).toBeLessThanOrEqual(160);
    expect(p!.preview.endsWith('…')).toBe(true);
  });

  it('nothing pinned, a deleted message, an automatic event or an event reply is no pin', () => {
    expect(pinFromRow(null)).toBeNull();
    expect(pinFromRow({ message_id: null, messages: null })).toBeNull();
    expect(pinFromRow({ message_id: 'm-1', messages: null })).toBeNull(); // not visible to this viewer
    expect(pinFromRow(row({ deleted_at: '2026-10-01T10:00:00Z' }))).toBeNull();
    expect(pinFromRow(row({ message_type: 'system' }))).toBeNull();
    expect(pinFromRow(row({ parent_message_id: 'e-1' }))).toBeNull();
  });

  it('an author who left the team is shown as such, not as an empty name', () => {
    expect(pinFromRow(row({ profiles: null }))?.authorName).toBe('Ehemaliges Mitglied');
    expect(pinFromRow(row({ profiles: { full_name: null } }))?.authorName).toBe('Mitglied');
  });

  it('the shared select names exactly what the mapper reads', () => {
    for (const column of ['message_id', 'content', 'message_type', 'deleted_at', 'parent_message_id', 'full_name']) expect(PIN_SELECT).toContain(column);
  });
});
