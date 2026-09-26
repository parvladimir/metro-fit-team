// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SystemEventCard } from '@/components/chat/SystemEventCard';
import type { ChatMessage } from '@/lib/data/chat';

function baseMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    team_id: 't1',
    user_id: 'u1',
    reply_to_id: null,
    parent_message_id: null,
    content: '',
    message_type: 'system',
    attachment_path: null,
    attachment_mime: null,
    attachment_width: null,
    attachment_height: null,
    event_type: null,
    metadata: {},
    workout_id: null,
    created_at: '2026-09-24T18:56:00Z',
    edited_at: null,
    deleted_at: null,
    authorName: 'Tim A',
    authorAvatar: null,
    creatorName: null,
    ...overrides,
  };
}

function render(message: ChatMessage, isFirstUnread = false) {
  return renderToStaticMarkup(createElement(SystemEventCard, { message, isFirstUnread, label: 'Neue Nachrichten' }));
}

describe('SystemEventCard', () => {
  it('a started event shows the sentence and a posted-at time, no duration or Beginn line', () => {
    const html = render(baseMessage({ event_type: 'workout_started', metadata: { title: 'Push B' } }));
    expect(html).toContain('Tim A hat „Push B“ gestartet.');
    expect(html).toMatch(/\d{2}:\d{2} Uhr/);
    expect(html).not.toContain('Beginn:');
  });

  it('a completed event shows duration and Beginn on the secondary block, never a bare oversized minute count', () => {
    const html = render(
      baseMessage({
        event_type: 'workout_completed',
        metadata: { title: 'Push B', duration_minutes: 435, started_at: '2026-09-24T11:30:00Z' },
      })
    );
    expect(html).toContain('Tim A hat „Push B“ abgeschlossen.');
    expect(html).not.toContain('435 Min.');
    expect(html).toContain('7 Std. 15 Min.');
    expect(html).toContain('Beginn:');
  });

  it('flags a manually corrected duration without hiding it', () => {
    const html = render(
      baseMessage({ event_type: 'workout_completed', metadata: { duration_minutes: 45, duration_source: 'corrected' } })
    );
    expect(html).toContain('45 Min. (korrigiert)');
  });

  it('omits the Beginn line when no started_at is present (e.g. a pre-existing event)', () => {
    const html = render(baseMessage({ event_type: 'workout_completed', metadata: { duration_minutes: 45 } }));
    expect(html).not.toContain('Beginn:');
  });

  it('omits the duration segment when there is nothing to show', () => {
    const html = render(baseMessage({ event_type: 'workout_completed', metadata: {} }));
    expect(html).toContain('Tim A hat ein Training abgeschlossen.');
    expect(html).not.toContain('Min.');
    expect(html).not.toContain('Std.');
  });

  it('weekly goal and challenge events never show a duration or Beginn line', () => {
    const goal = render(baseMessage({ event_type: 'weekly_goal_reached', metadata: {} }));
    expect(goal).toContain('hat das Wochenziel erreicht.');
    expect(goal).not.toContain('Beginn:');

    const challenge = render(baseMessage({ event_type: 'challenge_completed', metadata: { title: '4 Trainings' } }));
    expect(challenge).toContain('hat die Herausforderung „4 Trainings“ abgeschlossen.');
    expect(challenge).not.toContain('Beginn:');
  });

  it('shows the "new messages" divider only when isFirstUnread is true', () => {
    const message = baseMessage({ event_type: 'workout_started', metadata: {} });
    expect(render(message, true)).toContain('Neue Nachrichten');
    expect(render(message, false)).not.toContain('Neue Nachrichten');
  });
});
