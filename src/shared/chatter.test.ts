import { describe, expect, it } from 'vitest';
import {
  CHATTER_MAX_LENGTH,
  chatterWeekKey,
  chatterWeekLabel,
  chatterWeekStart,
  validateChatterText,
} from './chatter';

describe('City Chatter text validation', () => {
  it('normalizes a valid message without changing its meaning', () => {
    expect(validateChatterText('  Hold   the north wall.  ')).toEqual({
      ok: true,
      text: 'Hold the north wall.',
      duplicateKey: 'hold the north wall.',
    });
  });

  it.each([
    [undefined, 'Write a message first.'],
    ['   ', 'Write a message first.'],
    ['Visit https://example.com', 'Links are disabled in City Chatter for launch.'],
    ['kys now', 'That message cannot be posted to City Chatter.'],
  ])('rejects unsafe input %#', (input, message) => {
    expect(validateChatterText(input)).toEqual({ ok: false, message });
  });

  it('counts Unicode characters instead of UTF-16 code units', () => {
    const valid = '🌅'.repeat(CHATTER_MAX_LENGTH);
    expect(validateChatterText(valid).ok).toBe(true);
    expect(validateChatterText(`${valid}🌅`)).toEqual({
      ok: false,
      message: `Keep city chatter to ${CHATTER_MAX_LENGTH} characters.`,
    });
  });
});

describe('City Chatter UTC week routing', () => {
  it('keeps Monday through Sunday in one weekly hub', () => {
    const monday = new Date('2026-07-13T00:00:00.000Z');
    const sunday = new Date('2026-07-19T23:59:59.999Z');

    expect(chatterWeekStart(sunday)).toEqual(monday);
    expect(chatterWeekKey(monday)).toBe('2026-07-13');
    expect(chatterWeekKey(sunday)).toBe('2026-07-13');
    expect(chatterWeekLabel(sunday)).toBe('Jul 13–Jul 19, 2026');
  });

  it('handles a week that crosses the year boundary', () => {
    const friday = new Date('2027-01-01T12:00:00.000Z');
    expect(chatterWeekKey(friday)).toBe('2026-12-28');
    expect(chatterWeekLabel(friday)).toBe('Dec 28–Jan 3, 2027');
  });
});
