/**
 * @mentions: pure helpers (autocomplete matching, insertion, resolution).
 * Identity always comes from user ids stored in message_mentions — the visible
 * "@Name" in the text is only what gets highlighted for resolved mentions.
 */

export interface MentionMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  role?: 'member' | 'team_admin';
}

/** A resolved mention as stored in the database. */
export interface MessageMention {
  userId: string;
  /** "@Full Name" exactly as it appears in the message text */
  text: string;
}

export interface MentionQuery {
  /** index of the "@" */
  start: number;
  query: string;
}

const MAX_QUERY_LENGTH = 30;

/** Finds an in-progress "@query" ending at the caret. An "@" only counts at the
 * start of the text or after whitespace/an opening bracket — so e-mail
 * addresses like a@b.de never open the list. */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const prev = at === 0 ? '' : before[at - 1]!;
  if (prev && !/[\s([{"„'>]/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH || /[\n@]/.test(query)) return null;
  // names have at most a few words; a long tail of spaces means it is just text
  if ((query.match(/ /g) ?? []).length > 3) return null;
  return { start: at, query };
}

function norm(s: string): string {
  return s.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Filters members while typing: prefix of the full name or of any word ranks
 * first, then substring matches. Diacritics are ignored (Özcan ~ ozcan). */
export function filterMembers(members: MentionMember[], query: string, limit = 6): MentionMember[] {
  const q = norm(query.trim());
  const scored = members
    .map((m) => {
      const name = norm(m.name);
      let score = -1;
      if (!q) score = 3;
      else if (name.startsWith(q)) score = 0;
      else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
      else if (name.includes(q)) score = 2;
      return { m, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.m.name.localeCompare(b.m.name, 'de'));
  return scored.slice(0, limit).map((x) => x.m);
}

/** Replaces the "@query" being typed with "@Full Name " and returns the new text + caret. */
export function insertMention(text: string, q: MentionQuery, caret: number, name: string): { text: string; caret: number } {
  const rest = text.slice(caret);
  const needsSpace = !/^\s/.test(rest);
  const inserted = `@${name}${needsSpace ? ' ' : ''}`;
  const next = text.slice(0, q.start) + inserted + rest;
  // caret lands after the space that follows the mention
  return { text: next, caret: q.start + `@${name} `.length };
}

export function mentionText(name: string): string {
  return `@${name.trim()}`;
}

function isBoundaryBefore(text: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}_.@]/u.test(text[index - 1]!);
}
function isBoundaryAfter(text: string, index: number): boolean {
  return index >= text.length || !/[\p{L}\p{N}_]/u.test(text[index]!);
}

/** Positions where a resolved mention's text occurs as a whole "word group". */
export function findMentionRanges(text: string, mentions: MessageMention[]): { start: number; end: number; userId: string }[] {
  const ranges: { start: number; end: number; userId: string }[] = [];
  // longest first so "@Anna Maria" wins over "@Anna"
  const sorted = [...mentions].sort((a, b) => b.text.length - a.text.length);
  for (const m of sorted) {
    let from = 0;
    while (from <= text.length) {
      const i = text.indexOf(m.text, from);
      if (i === -1) break;
      const end = i + m.text.length;
      const overlaps = ranges.some((r) => i < r.end && end > r.start);
      if (!overlaps && isBoundaryBefore(text, i) && isBoundaryAfter(text, end)) ranges.push({ start: i, end, userId: m.userId });
      from = end;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Split a plain text node into text / mention parts (used by the Markdown renderer). */
export function splitByMentions(text: string, mentions: MessageMention[]): ({ type: 'text'; value: string } | { type: 'mention'; value: string; userId: string })[] {
  const ranges = findMentionRanges(text, mentions);
  if (ranges.length === 0) return [{ type: 'text', value: text }];
  const out: ({ type: 'text'; value: string } | { type: 'mention'; value: string; userId: string })[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ type: 'text', value: text.slice(pos, r.start) });
    out.push({ type: 'mention', value: text.slice(r.start, r.end), userId: r.userId });
    pos = r.end;
  }
  if (pos < text.length) out.push({ type: 'text', value: text.slice(pos) });
  return out;
}

/** Client-side: which of the selected members are still literally in the text. */
export function stillMentioned(text: string, selected: MentionMember[]): MentionMember[] {
  const mentions = selected.map((m) => ({ userId: m.id, text: mentionText(m.name) }));
  const present = new Set(findMentionRanges(text, mentions).map((r) => r.userId));
  return selected.filter((m) => present.has(m.id));
}

/** Server-side resolution: keeps only ids that are real team members whose
 * current "@Name" is in the content. Everything else is silently dropped. */
export function resolveMentions(
  content: string,
  requestedIds: string[],
  teamMembers: { id: string; name: string | null }[],
  authorId: string
): MessageMention[] {
  const byId = new Map(teamMembers.map((m) => [m.id, m.name?.trim() || null]));
  const candidates: MessageMention[] = [];
  for (const id of [...new Set(requestedIds)].slice(0, 20)) {
    const name = byId.get(id);
    if (!name || id === authorId) continue;
    candidates.push({ userId: id, text: mentionText(name) });
  }
  const present = new Set(findMentionRanges(content, candidates).map((r) => r.userId));
  return candidates.filter((c) => present.has(c.userId));
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(v);
}
