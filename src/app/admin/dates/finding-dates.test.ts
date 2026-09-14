import { describe, it, expect } from 'vitest';
import { auditEvent, type AuditableEvent } from '@/lib/date-consistency';
import { formatCivilDayLocalized, formatHebrewDateLocalized } from '@/lib/date-format';
import { getT } from '@/lib/translations';
import { eventTypeLabel, findingDates } from './finding-dates';

/** Fictional rows; the dates are the ones date-consistency.test.ts already uses. */
const ev = (over: Partial<AuditableEvent> = {}): AuditableEvent => ({
  id: 1,
  person_name: 'Dina Levi',
  event_type: 'birthday',
  hebrew_day: 12,
  hebrew_month: 'Sivan',
  original_english_date: '1978-06-07',
  ...over,
});

describe('findingDates', () => {
  it('formats a mismatch with the calendar’s own helpers, in each language', () => {
    const f = auditEvent(ev());
    expect(findingDates(f, 'en')).toEqual({
      hebrew: '12 Sivan',
      english: 'June 7, 1978',
      expected: 'June 17, 1978',
      fallsOn: '2 Sivan 5738',
    });
    expect(findingDates(f, 'he')).toEqual({
      hebrew: formatHebrewDateLocalized(12, 'Sivan', null, 'he'),
      english: formatCivilDayLocalized('1978-06-07', 'he'),
      expected: formatCivilDayLocalized('1978-06-17', 'he'),
      fallsOn: formatHebrewDateLocalized(2, 'Sivan', 5738, 'he'),
    });
    expect(findingDates(f, 'he').english).toBe('7 ביוני 1978');
  });

  it('shows an unreadable stored date as typed, never rolled over into a real-looking day', () => {
    // 1995-02-30 through a date formatter would come out as a date in March.
    expect(findingDates(auditEvent(ev({ original_english_date: '1995-02-30' })), 'en').english).toBe('1995-02-30');
    expect(findingDates(auditEvent(ev({ original_english_date: '17/09/1995' })), 'he').english).toBe('17/09/1995');
  });

  it('marks a missing date rather than printing "null"', () => {
    const d = findingDates(auditEvent(ev({ original_english_date: null })), 'he');
    expect(d.english).toBe('—');
    expect(d.expected).toBe('—');
    expect(d.fallsOn).toBe('—');
  });
});

describe('eventTypeLabel', () => {
  it('uses the calendar’s event labels, and shows an unknown type as stored', () => {
    expect(eventTypeLabel('yahrtzeit', getT('he'))).toBe('יארצייט');
    expect(eventTypeLabel('anniversary', getT('en'))).toBe('Anniversary');
    expect(eventTypeLabel('graduation', getT('he'))).toBe('graduation');
  });
});
