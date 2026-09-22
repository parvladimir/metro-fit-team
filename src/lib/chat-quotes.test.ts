import { describe, expect, it } from 'vitest';
import { splitTextByQuotes } from './chat-quotes';

describe('splitTextByQuotes', () => {
  it('returns the whole string as one text part when there is nothing to quote', () => {
    expect(splitTextByQuotes('Hallo zusammen!')).toEqual([{ type: 'text', value: 'Hallo zusammen!' }]);
  });

  it('detects German low-high quotes „…"', () => {
    expect(splitTextByQuotes('Unter „Meine Vorlagen“ findet ihr das.')).toEqual([
      { type: 'text', value: 'Unter ' },
      { type: 'quote', value: '„Meine Vorlagen“' },
      { type: 'text', value: ' findet ihr das.' },
    ]);
  });

  it('detects English curly quotes "…"', () => {
    expect(splitTextByQuotes('Tippe auf "Speichern".')).toEqual([
      { type: 'text', value: 'Tippe auf ' },
      { type: 'quote', value: '"Speichern"' },
      { type: 'text', value: '.' },
    ]);
  });

  it('detects straight ASCII quotes "..."', () => {
    expect(splitTextByQuotes('Der Plan "Push A" ist jetzt verfügbar.')).toEqual([
      { type: 'text', value: 'Der Plan ' },
      { type: 'quote', value: '"Push A"' },
      { type: 'text', value: ' ist jetzt verfügbar.' },
    ]);
  });

  it('detects guillemets «…»', () => {
    expect(splitTextByQuotes('Klicke auf «Weiter».')).toEqual([
      { type: 'text', value: 'Klicke auf ' },
      { type: 'quote', value: '«Weiter»' },
      { type: 'text', value: '.' },
    ]);
  });

  it('finds multiple separate quotes in one string', () => {
    const text = 'Mit „Aus Vorlage erstellen“ übernehmt ihr die Übungen für „einen neuen Tag“.';
    expect(splitTextByQuotes(text)).toEqual([
      { type: 'text', value: 'Mit ' },
      { type: 'quote', value: '„Aus Vorlage erstellen“' },
      { type: 'text', value: ' übernehmt ihr die Übungen für ' },
      { type: 'quote', value: '„einen neuen Tag“' },
      { type: 'text', value: '.' },
    ]);
  });

  it('leaves an unmatched opening mark as plain text', () => {
    expect(splitTextByQuotes('Das war „komisch, keine Ahnung warum.')).toEqual([
      { type: 'text', value: 'Das war „komisch, keine Ahnung warum.' },
    ]);
  });

  it('still finds a later valid pair after an earlier unmatched mark', () => {
    const text = 'Er sagte „naja... und dann war "Push A" fertig.';
    expect(splitTextByQuotes(text)).toEqual([
      { type: 'text', value: 'Er sagte „naja... und dann war ' },
      { type: 'quote', value: '"Push A"' },
      { type: 'text', value: ' fertig.' },
    ]);
  });

  it('never treats a measurement like 27" as a quote', () => {
    expect(splitTextByQuotes('Der Monitor ist 27" groß.')).toEqual([
      { type: 'text', value: 'Der Monitor ist 27" groß.' },
    ]);
  });

  it('does not pair two unrelated measurements as one quote', () => {
    expect(splitTextByQuotes('12" x 18" Format')).toEqual([{ type: 'text', value: '12" x 18" Format' }]);
  });

  it('does not treat an apostrophe as a quote mark (only doubles are handled)', () => {
    expect(splitTextByQuotes("Das ist Tim's Plan.")).toEqual([{ type: 'text', value: "Das ist Tim's Plan." }]);
  });

  it('does not span an implausibly long run of text as one "quote"', () => {
    const long = 'x'.repeat(400);
    const text = `„${long}“ Ende`;
    expect(splitTextByQuotes(text)).toEqual([{ type: 'text', value: text }]);
  });

  it('handles a quote at the very start and very end of the string', () => {
    expect(splitTextByQuotes('„Start“ Mitte "Ende"')).toEqual([
      { type: 'quote', value: '„Start“' },
      { type: 'text', value: ' Mitte ' },
      { type: 'quote', value: '"Ende"' },
    ]);
  });

  it('keeps the exact wording and punctuation, marks included, inside the quote part', () => {
    const parts = splitTextByQuotes('Sie sagte „Ja, genau!“ heute.');
    expect(parts[1]).toEqual({ type: 'quote', value: '„Ja, genau!“' });
  });
});
