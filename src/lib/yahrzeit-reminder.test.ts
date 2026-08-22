import { describe, it, expect } from 'vitest';
import {
  clampLead,
  targetDateForLead,
  buildYahrzeitMessage,
  ymd,
  DEFAULT_LEAD_DAYS,
} from './yahrzeit-reminder';

describe('clampLead', () => {
  it('defaults to eve-before (1) when missing or empty', () => {
    expect(clampLead(null)).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead(undefined)).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead('')).toBe(DEFAULT_LEAD_DAYS);
  });
  it('accepts an in-range integer', () => {
    expect(clampLead('7')).toBe(7);
    expect(clampLead('1')).toBe(1);
    expect(clampLead('60')).toBe(60);
  });
  it('falls back to default on garbage / out-of-range / non-integer', () => {
    expect(clampLead('0')).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead('-3')).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead('61')).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead('abc')).toBe(DEFAULT_LEAD_DAYS);
    expect(clampLead('2.5')).toBe(DEFAULT_LEAD_DAYS);
  });
});

describe('targetDateForLead', () => {
  it('lead=1 → tomorrow (candle tonight)', () => {
    const today = new Date(2026, 6, 24); // Jul 24 2026
    expect(ymd(targetDateForLead(today, 1))).toBe('2026-07-25');
  });
  it('lead=7 → a week out', () => {
    const today = new Date(2026, 6, 24);
    expect(ymd(targetDateForLead(today, 7))).toBe('2026-07-31');
  });
  it('crosses month boundaries correctly', () => {
    const today = new Date(2026, 6, 30); // Jul 30
    expect(ymd(targetDateForLead(today, 3))).toBe('2026-08-02');
  });
});

describe('buildYahrzeitMessage', () => {
  const target = new Date(2026, 7, 21); // Fri Aug 21 2026
  const url = 'https://example.test';

  it('returns empty string when there is nothing to send', () => {
    expect(buildYahrzeitMessage([], target, 1, url)).toBe('');
  });

  it('eve-before copy for the default lead (candle this evening)', () => {
    const msg = buildYahrzeitMessage(['🕯️ Yaakov (9th yahrzeit)'], target, 1, url);
    expect(msg).toContain('Yahrzeit reminder');
    expect(msg).toContain('this evening at sundown');
    expect(msg).toContain('🕯️ Yaakov (9th yahrzeit)');
    expect(msg).toContain(url);
  });

  it('advance heads-up copy for a larger lead', () => {
    const msg = buildYahrzeitMessage(['🕯️ Yaakov'], target, 7, url);
    expect(msg).toContain('Upcoming yahrzeit');
    expect(msg).toContain('coming up in 7 days');
    expect(msg).not.toContain('this evening at sundown');
  });

  it('pluralizes for multiple names', () => {
    const msg = buildYahrzeitMessage(['🕯️ A', '🕯️ B'], target, 1, url);
    expect(msg).toContain('Yahrzeits begin this evening');
  });
});
