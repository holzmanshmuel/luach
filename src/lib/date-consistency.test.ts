import { describe, it, expect } from 'vitest';
import { auditEvent, auditEvents, type AuditableEvent } from './date-consistency';

/** A minimal auditable row; every test overrides only what it cares about. */
const ev = (over: Partial<AuditableEvent> = {}): AuditableEvent => ({
  id: 1,
  person_name: 'Test Person',
  event_type: 'birthday',
  hebrew_day: 12,
  hebrew_month: 'Sivan',
  original_english_date: '1978-06-17',
  ...over,
});

describe('auditEvent — the shape of bug this exists to catch', () => {
  // The real-world failure: a spreadsheet cell holding a two-digit day loses its
  // leading digit, so "the 17th" is typed as "the 7th". Both halves of the row
  // still parse perfectly, the Hebrew date stays correct, and the calendar shows
  // the English birthday ten days early — for years, until someone is wished a
  // happy birthday on the wrong day.
  it('flags a dropped leading digit in the day of the month', () => {
    const f = auditEvent(ev({ original_english_date: '1978-06-07' }));
    expect(f.verdict).toBe('mismatch');
    expect(f.stored_hebrew).toBe('12 Sivan');
    expect(f.english_falls_on).toBe('2 Sivan 5738');
    expect(f.expected_english).toBe('1978-06-17');
    expect(f.offset_days).toBe(-10);
  });

  it('passes the same row once the English date is corrected', () => {
    const f = auditEvent(ev({ original_english_date: '1978-06-17' }));
    expect(f.verdict).toBe('ok');
    expect(f.offset_days).toBe(0);
    expect(f.english_falls_on).toBe('12 Sivan 5738');
  });
});

describe('auditEvent — the nightfall day is not an error', () => {
  // The Hebrew day starts at nightfall, so a birth on the evening of the civil
  // day before carries the NEXT day's Hebrew date. One day apart is normal.
  it('treats a one-day gap as nightfall, not a mismatch', () => {
    const f = auditEvent(ev({ original_english_date: '1978-06-16' }));
    expect(f.offset_days).toBe(-1);
    expect(f.verdict).toBe('nightfall');
  });

  it('treats a one-day gap in the other direction as nightfall too', () => {
    const f = auditEvent(ev({ original_english_date: '1978-06-18' }));
    expect(f.offset_days).toBe(1);
    expect(f.verdict).toBe('nightfall');
  });

  it('flags two days as a mismatch — the tolerance is exactly one day', () => {
    const f = auditEvent(ev({ original_english_date: '1978-06-19' }));
    expect(f.offset_days).toBe(2);
    expect(f.verdict).toBe('mismatch');
  });
});

describe('auditEvent — a Hebrew date near the civil-year boundary', () => {
  // 5 Tevet 5760 fell on 1999-12-14. Probing only the stored date's own civil
  // year could match the OTHER Tevet occurrence in 1999 (early January) and
  // report a ~340-day gap for a perfectly good row.
  it('does not report a false ~year-long gap for a late-December date', () => {
    const f = auditEvent(
      ev({ hebrew_day: 5, hebrew_month: 'Tevet', original_english_date: '1999-12-14' })
    );
    expect(f.verdict).toBe('ok');
    expect(f.offset_days).toBe(0);
  });

  it('still flags a real typo on a boundary date', () => {
    const f = auditEvent(
      ev({ hebrew_day: 5, hebrew_month: 'Tevet', original_english_date: '1999-12-04' })
    );
    expect(f.verdict).toBe('mismatch');
    expect(f.offset_days).toBe(-10);
  });
});

describe('auditEvent — Adar, without comparing month names', () => {
  // A generic-Adar birth recurs in Adar II in a leap year. The audit projects the
  // stored Hebrew date with the app's own recurrence rule, so it never has to
  // decide whether "Adar" and "Adar II" are the same string.
  it('accepts a generic-Adar row whose English date is that Adar', () => {
    // 1997-03-24 was 15 Adar II 5757 (5757 is a leap year).
    const f = auditEvent(
      ev({ hebrew_day: 15, hebrew_month: 'Adar', original_english_date: '1997-03-24' })
    );
    expect(f.verdict).toBe('ok');
  });

  it('accepts the same date stored explicitly as Adar II', () => {
    const f = auditEvent(
      ev({ hebrew_day: 15, hebrew_month: 'Adar II', original_english_date: '1997-03-24' })
    );
    expect(f.verdict).toBe('ok');
  });

  // 1997-02-08 was 1 Adar I 5757. Stored as a generic 'Adar', this app recurs the
  // day in Adar II, so the English date reads a month out — every leap year,
  // forever, with nothing mistyped. That is a question of custom, not a typo, and
  // must never be offered the blunt "one of these is wrong" correction.
  it('calls out an Adar I birth stored as generic Adar, rather than crying typo', () => {
    const f = auditEvent(
      ev({ hebrew_day: 1, hebrew_month: 'Adar', original_english_date: '1997-02-08' })
    );
    expect(f.verdict).toBe('adar_convention');
    expect(f.english_falls_on).toBe('1 Adar I 5757');
    expect(Math.abs(f.offset_days!)).toBeGreaterThan(25);
  });

  it('calls out the mirror case — an Adar II date stored as Adar I', () => {
    // 1997-03-24 was 15 Adar II 5757; stored as Adar I it resolves a month early.
    const f = auditEvent(
      ev({ hebrew_day: 15, hebrew_month: 'Adar I', original_english_date: '1997-03-24' })
    );
    expect(f.verdict).toBe('adar_convention');
  });

  it('still calls a real Adar typo a mismatch, not a convention', () => {
    // Different DAY of the month, so no amount of Adar-choosing explains it.
    const f = auditEvent(
      ev({ hebrew_day: 9, hebrew_month: 'Adar', original_english_date: '1997-02-08' })
    );
    expect(f.verdict).toBe('mismatch');
  });
});

describe('auditEvent — rows with nothing to check', () => {
  it('reports no_english when the family never recorded a civil date', () => {
    const f = auditEvent(ev({ original_english_date: null }));
    expect(f.verdict).toBe('no_english');
    expect(f.expected_english).toBeNull();
    expect(f.offset_days).toBeNull();
  });

  it('reports unconvertible for a malformed stored date', () => {
    expect(auditEvent(ev({ original_english_date: '17/09/1995' })).verdict).toBe('unconvertible');
  });

  it('reports unconvertible for an impossible date rather than rolling it over', () => {
    // Date() would happily turn Feb 30 into Mar 1 or 2; the audit must not.
    expect(auditEvent(ev({ original_english_date: '1995-02-30' })).verdict).toBe('unconvertible');
  });

  it('reports unconvertible for an unrecognised Hebrew month', () => {
    const f = auditEvent(ev({ hebrew_month: 'Marcheshvan' }));
    expect(f.verdict).toBe('unconvertible');
    expect(f.expected_english).toBeNull();
  });
});

describe('auditEvents — the report', () => {
  it('counts every verdict and lists only the rows needing attention', () => {
    const report = auditEvents([
      ev({ id: 1, original_english_date: '1978-06-17' }), // ok
      ev({ id: 2, original_english_date: '1978-06-16' }), // nightfall
      ev({ id: 3, original_english_date: '1978-06-07' }), // mismatch, -10
      ev({ id: 4, original_english_date: null }), // no_english
      ev({ id: 5, original_english_date: 'nonsense' }), // unconvertible
      ev({ id: 6, hebrew_day: 1, hebrew_month: 'Adar', original_english_date: '1997-02-08' }),
    ]);

    expect(report.summary).toEqual({
      total: 6,
      ok: 1,
      nightfall: 1,
      mismatch: 1,
      adar_convention: 1,
      no_english: 1,
      unconvertible: 1,
    });
    expect(report.problems.map(p => p.id)).toEqual([3, 5]);
    // The Adar row is kept OUT of `problems` — it is a decision, not a defect.
    expect(report.adarChoices.map(p => p.id)).toEqual([6]);
  });

  it('puts the worst gap first', () => {
    const report = auditEvents([
      ev({ id: 1, original_english_date: '1978-06-19' }), // +2
      ev({ id: 2, original_english_date: '1978-06-07' }), // -10
      ev({ id: 3, original_english_date: '1978-06-22' }), // +5
    ]);
    expect(report.problems.map(p => p.id)).toEqual([2, 3, 1]);
  });

  it('returns an empty problem list for a clean family', () => {
    const report = auditEvents([ev({ original_english_date: '1978-06-17' })]);
    expect(report.problems).toEqual([]);
    expect(report.summary.mismatch).toBe(0);
  });
});
