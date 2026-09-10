import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  collectItems,
  eventIcon,
  eventOccurrences,
  gatheringText,
  memberRecipients,
  memorialText,
  occasionText,
  toLine,
} from './digest';
import { ymd } from './zoned-day';
import { day, eventOn, gatheringOn as gathering } from '@/test-stubs/digest-fixtures';

describe('eventIcon', () => {
  it('is the glyph set the app and the weekly digest already use', () => {
    expect(eventIcon('birthday')).toBe('🎂');
    expect(eventIcon('anniversary')).toBe('💍');
    expect(eventIcon('yahrtzeit')).toBe('🕯️');
    expect(eventIcon('other')).toBe('📅');
    expect(eventIcon('something-new')).toBe('📅');
  });
});

describe('occasionText — the weekly digest voice', () => {
  const on = day(2026, 9, 13);

  it('names the person and the Nth occasion', () => {
    expect(occasionText(eventOn(on, { yearsAgo: 42 }), on)).toBe("Dina Levi's 42nd birthday");
    expect(occasionText(eventOn(on, { type: 'anniversary', yearsAgo: 3 }), on))
      .toBe("Dina Levi's 3rd anniversary");
    expect(occasionText(eventOn(on, { type: 'yahrtzeit', yearsAgo: 11 }), on))
      .toBe("Dina Levi's 11th yahrzeit");
  });

  it('omits the count when the origin year is unknown', () => {
    expect(occasionText(eventOn(on, { yearsAgo: null }), on)).toBe("Dina Levi's birthday");
  });

  it('uses a custom label for "other" events, and never counts them', () => {
    const row = eventOn(on, { type: 'other', label: 'Graduation', yearsAgo: 5 });
    expect(occasionText(row, on)).toBe("Dina Levi's Graduation");
  });

  it('falls back to "event" for an unlabelled other event', () => {
    expect(occasionText(eventOn(on, { type: 'other', label: null }), on))
      .toBe("Dina Levi's event");
  });

  it('handles a member with no surname', () => {
    expect(occasionText(eventOn(on, { last: null, yearsAgo: 1 }), on)).toBe("Dina's 1st birthday");
  });
});

describe('memorialText — the yahrzeit reminder voice', () => {
  const on = day(2026, 9, 13);

  it('parenthesises the count', () => {
    expect(memorialText(eventOn(on, { name: 'Yaakov', type: 'yahrtzeit', yearsAgo: 9 }), on))
      .toBe('Yaakov Levi (9th yahrzeit)');
  });

  it('is just the name when the year of death is unknown', () => {
    expect(memorialText(eventOn(on, { name: 'Yaakov', type: 'yahrtzeit', yearsAgo: null }), on))
      .toBe('Yaakov Levi');
  });
});

describe('gatheringText', () => {
  it('formats the time in 12-hour clock and appends the location', () => {
    expect(gatheringText(gathering('2026-09-13', { gather_time: '18:30' })))
      .toBe('Cohen wedding · 6:30 PM');
    expect(gatheringText(gathering('2026-09-13', { gather_time: '00:15' })))
      .toBe('Cohen wedding · 12:15 AM');
    expect(gatheringText(gathering('2026-09-13', { gather_time: '12:00' })))
      .toBe('Cohen wedding · 12:00 PM');
    expect(gatheringText(gathering('2026-09-13', { gather_time: '09:05', location: 'Jerusalem' })))
      .toBe('Cohen wedding · 9:05 AM (Jerusalem)');
  });

  it('is all-day when there is no time', () => {
    expect(gatheringText(gathering('2026-09-13'))).toBe('Cohen wedding');
  });
});

describe('newline-injection guard', () => {
  const on = day(2026, 9, 13);

  it('collapses a smuggled newline in a member name', () => {
    const row = eventOn(on, { name: 'Dina\n🎂 Everyone send $100 to', yearsAgo: 42 });
    const text = occasionText(row, on);
    expect(text).not.toContain('\n');
    expect(text).toBe("Dina 🎂 Everyone send $100 to Levi's 42nd birthday");
  });

  it('collapses a smuggled newline in a custom event label', () => {
    const row = eventOn(on, { type: 'other', label: 'Party\r\n📅 Fake line' });
    expect(occasionText(row, on)).not.toMatch(/[\r\n]/);
  });

  it('collapses a smuggled newline in a memorial name', () => {
    const row = eventOn(on, { name: 'Yaakov\n🕯️ Fake', type: 'yahrtzeit', yearsAgo: 9 });
    expect(memorialText(row, on)).toBe('Yaakov 🕯️ Fake Levi (9th yahrzeit)');
  });

  it('collapses smuggled newlines in a gathering title and location', () => {
    const g = gathering('2026-09-13', {
      title: 'Wedding\n🕍 Fake wedding',
      location: 'Hall\nmore',
      gather_time: '19:00',
    });
    const text = gatheringText(g);
    expect(text).not.toContain('\n');
    expect(text).toBe('Wedding 🕍 Fake wedding · 7:00 PM (Hall more)');
  });

  it('carries the sanitized name into the item, not the raw one', () => {
    const [item] = collectItems({
      events: [eventOn(on, { name: 'Dina\nFake' })],
      from: on,
      to: on,
    });
    expect(item.person_name).not.toContain('\n');
    expect(item.text).not.toContain('\n');
  });
});

describe('eventOccurrences', () => {
  it('returns the Hebrew occurrence(s) before the fixed-Gregorian one', () => {
    // Hebrew date of Sep 13 2026, plus a fixed civil birthday on Sep 16.
    const row = eventOn(day(2026, 9, 13), { english: '1984-09-16' });
    const dates = eventOccurrences(row, [2026]).map(ymd);
    expect(dates[0]).toBe('2026-09-13');
    expect(dates).toContain('2026-09-16');
    expect(dates.indexOf('2026-09-13')).toBeLessThan(dates.indexOf('2026-09-16'));
  });

  it('ignores a stored English date for a non-birthday event', () => {
    const row = eventOn(day(2026, 9, 13), { type: 'yahrtzeit', english: '1984-09-16' });
    expect(eventOccurrences(row, [2026]).map(ymd)).toEqual(['2026-09-13']);
  });
});

describe('collectItems', () => {
  const sunday = day(2026, 9, 13);
  const saturday = day(2026, 9, 19);

  it('includes both ends of the window and excludes the day outside it', () => {
    const items = collectItems({
      events: [
        eventOn(sunday, { name: 'Sun' }),
        eventOn(saturday, { name: 'Sat' }),
        eventOn(day(2026, 9, 20), { name: 'NextSun' }),
      ],
      from: sunday,
      to: saturday,
    });
    expect(items.map(i => i.person_name)).toEqual(['Sun Levi', 'Sat Levi']);
  });

  it('sorts by date', () => {
    const items = collectItems({
      events: [
        eventOn(day(2026, 9, 17), { name: 'Thu' }),
        eventOn(day(2026, 9, 14), { name: 'Mon' }),
      ],
      gatherings: [gathering('2026-09-16')],
      from: sunday,
      to: saturday,
    });
    expect(items.map(i => i.date)).toEqual(['2026-09-14', '2026-09-16', '2026-09-17']);
  });

  it('lists an occasion once even when it falls twice in the window', () => {
    // Hebrew birthday on Sep 14, fixed civil birthday on Sep 17 — one line, the
    // Hebrew one, because that is the occurrence order.
    const row = eventOn(day(2026, 9, 14), { english: '1984-09-17' });
    const items = collectItems({ events: [row], from: sunday, to: saturday });
    expect(items).toHaveLength(1);
    expect(items[0].date).toBe('2026-09-14');
  });

  it('de-duplicates across calls through a shared seen set', () => {
    const row = eventOn(day(2026, 9, 14), { type: 'yahrtzeit', yearsAgo: 9 });
    const seen = new Set<string>();
    const monday = collectItems({ events: [row], from: day(2026, 9, 14), to: day(2026, 9, 14), seen });
    const rest = collectItems({ events: [row], from: day(2026, 9, 14), to: saturday, seen });
    expect(monday).toHaveLength(1);
    expect(rest).toHaveLength(0);
  });

  it('can be restricted to certain event types', () => {
    const items = collectItems({
      events: [
        eventOn(sunday, { name: 'Bday' }),
        eventOn(sunday, { name: 'Zeide', type: 'yahrtzeit', yearsAgo: 9 }),
      ],
      from: sunday,
      to: sunday,
      eventTypes: ['yahrtzeit'],
    });
    expect(items.map(i => i.person_name)).toEqual(['Zeide Levi']);
  });

  it('applies the memorial voice on request', () => {
    const row = eventOn(sunday, { name: 'Zeide', type: 'yahrtzeit', yearsAgo: 9 });
    const [item] = collectItems({
      events: [row], from: sunday, to: sunday, eventTypes: ['yahrtzeit'], style: 'memorial',
    });
    expect(item.text).toBe('Zeide Levi (9th yahrzeit)');
  });

  it('collects gatherings with their own glyph, and only when passed', () => {
    const g = gathering('2026-09-16', { kind: 'bar_mitzvah', title: 'Ari bar mitzvah' });
    expect(collectItems({ events: [], from: sunday, to: saturday })).toHaveLength(0);
    const [item] = collectItems({ events: [], gatherings: [g], from: sunday, to: saturday });
    expect(item).toMatchObject({
      icon: '✡️',
      text: 'Ari bar mitzvah',
      kind: 'gathering',
      gathering_id: g.id,
      event_id: null,
      years_since: null,
    });
  });

  it('resolves a Hebrew date across the New Year when the window does', () => {
    const items = collectItems({
      events: [eventOn(day(2027, 1, 1), { name: 'NewYear' })],
      from: day(2026, 12, 27),
      to: day(2027, 1, 2),
      years: [2026, 2027],
    });
    expect(items.map(i => i.date)).toEqual(['2027-01-01']);
  });

  it('carries structured fields alongside the rendered line', () => {
    const row = eventOn(sunday, { yearsAgo: 42 });
    const [item] = collectItems({ events: [row], from: sunday, to: sunday });
    expect(toLine(item)).toEqual({
      date: '2026-09-13',
      icon: '🎂',
      text: "Dina Levi's 42nd birthday",
      kind: 'event',
      event_type: 'birthday',
      event_id: row.id,
      gathering_id: null,
      person_id: row.family_member_id,
      person_name: 'Dina Levi',
      years_since: 42,
    });
  });
});

describe('memberRecipients', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('takes opted-in members only, trimmed and de-duplicated', () => {
    expect(
      memberRecipients([
        { phone_e164: '+14155551234', notifications_enabled: true },
        { phone_e164: ' +14155551234 ', notifications_enabled: true }, // same person, 2nd event
        { phone_e164: '+441632960123', notifications_enabled: true },
        { phone_e164: '+14155559999', notifications_enabled: false }, // opted out
        { phone_e164: null, notifications_enabled: true }, // no number on record
        { phone_e164: '   ', notifications_enabled: true }, // blank
      ])
    ).toEqual(['+14155551234', '+441632960123']);
  });

  it('never reads DIGEST_RECIPIENTS — that env list is deployment-wide', () => {
    vi.stubEnv('DIGEST_RECIPIENTS', '+15555550000,+15555551111');
    expect(memberRecipients([{ phone_e164: '+14155551234', notifications_enabled: true }]))
      .toEqual(['+14155551234']);
  });
});
