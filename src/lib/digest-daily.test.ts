import { describe, it, expect } from 'vitest';
import { buildDailyDigest, type DailyDigestInput } from './digest-daily';
import { day, eventOn, gatheringOn } from '@/test-stubs/digest-fixtures';

const SITE = 'https://calendar.example.test';
const TZ = 'Asia/Jerusalem';

// 08:00 Asia/Jerusalem (UTC+3 in September) — when the one morning job fires.
const THURSDAY = new Date('2026-09-10T05:00:00Z'); // Thu Sep 10 2026
const SUNDAY = new Date('2026-09-13T05:00:00Z'); // Sun Sep 13 2026

function digest(now: Date, input: Partial<DailyDigestInput> = {}) {
  return buildDailyDigest({
    events: [],
    gatherings: [],
    siteUrl: SITE,
    now,
    timeZone: TZ,
    ...input,
  });
}

describe('the "Today" block', () => {
  it('lists everything falling today, in the weekly digest voice', () => {
    const d = digest(THURSDAY, {
      events: [
        eventOn(day(2026, 9, 10), { name: 'Dina', yearsAgo: 42 }),
        eventOn(day(2026, 9, 10), { name: 'Rivka', type: 'anniversary', yearsAgo: 18 }),
        eventOn(day(2026, 9, 10), { name: 'Zeide', type: 'yahrtzeit', yearsAgo: 9 }),
        eventOn(day(2026, 9, 10), { name: 'Ari', type: 'other', label: 'Aliyah day' }),
      ],
      gatherings: [gatheringOn('2026-09-10', { title: 'Ari bar mitzvah', kind: 'bar_mitzvah' })],
    });

    expect(d.date).toBe('2026-09-10');
    expect(d.is_sunday).toBe(false);
    expect(d.has_content).toBe(true);
    expect(d.counts).toEqual({ today: 5, tonight: 0, later_this_week: 0, week_ahead: 0 });
    expect(d.message).toBe(
      '🗓️ *Today in the family* — Thursday, September 10\n' +
        '\n' +
        "🎂 Dina Levi's 42nd birthday\n" +
        "💍 Rivka Levi's 18th anniversary\n" +
        "🕯️ Zeide Levi's 9th yahrzeit\n" +
        "📅 Ari Levi's Aliyah day\n" +
        '✡️ Ari bar mitzvah\n' +
        '\n' +
        `See it all 👉 ${SITE}`
    );
    expect(d.message).not.toContain('Tonight begins');
    expect(d.message).not.toContain('Later in the week');
  });

  it('includes a birthday that recurs on its fixed civil date today', () => {
    // Hebrew date elsewhere in the year; the English birthday is today.
    const row = eventOn(day(2026, 4, 2), { name: 'Noam', english: '1990-09-10' });
    const d = digest(THURSDAY, { events: [row] });
    expect(d.counts.today).toBe(1);
    expect(d.today[0].text).toContain('Noam');
  });

  it('ignores events on other days', () => {
    const d = digest(THURSDAY, { events: [eventOn(day(2026, 9, 11), { name: 'Tomorrow' })] });
    expect(d.has_content).toBe(false);
  });
});

describe('the "Tonight begins" block', () => {
  it('names tomorrow\'s yahrzeits — the candle is lit at sundown tonight', () => {
    const d = digest(THURSDAY, {
      events: [eventOn(day(2026, 9, 11), { name: 'Yaakov', type: 'yahrtzeit', yearsAgo: 9 })],
    });

    expect(d.counts).toEqual({ today: 0, tonight: 1, later_this_week: 0, week_ahead: 0 });
    expect(d.tonight[0]).toMatchObject({
      date: '2026-09-11',
      icon: '🕯️',
      text: 'Yaakov Levi (9th yahrzeit)',
      years_since: 9,
    });
    expect(d.message).toBe(
      '🗓️ *Today in the family* — Thursday, September 10\n' +
        '\n' +
        '🕯️ *Tonight begins* — light a memorial candle at sundown:\n' +
        '🕯️ Yaakov Levi (9th yahrzeit)\n' +
        'May their memory be a blessing. 🤍\n' +
        '\n' +
        `See it all 👉 ${SITE}`
    );
  });

  it('takes only yahrzeits, never tomorrow\'s birthdays or simchas', () => {
    const d = digest(THURSDAY, {
      events: [
        eventOn(day(2026, 9, 11), { name: 'Tomorrow', type: 'birthday' }),
        eventOn(day(2026, 9, 11), { name: 'Bubby', type: 'yahrtzeit', yearsAgo: 3 }),
      ],
      gatherings: [gatheringOn('2026-09-11')],
    });
    expect(d.counts).toEqual({ today: 0, tonight: 1, later_this_week: 0, week_ahead: 0 });
    expect(d.tonight[0].text).toBe('Bubby Levi (3rd yahrzeit)');
  });

  it('sits below the Today block when both have content', () => {
    const d = digest(THURSDAY, {
      events: [
        eventOn(day(2026, 9, 10), { name: 'Dina', yearsAgo: 42 }),
        eventOn(day(2026, 9, 11), { name: 'Yaakov', type: 'yahrtzeit', yearsAgo: 9 }),
      ],
    });
    expect(d.message.indexOf("Dina Levi's 42nd birthday"))
      .toBeLessThan(d.message.indexOf('Tonight begins'));
    expect(d.counts).toEqual({ today: 1, tonight: 1, later_this_week: 0, week_ahead: 0 });
  });

  it('keeps a yahrzeit falling TODAY in the Today block, not tonight\'s', () => {
    const d = digest(THURSDAY, {
      events: [eventOn(day(2026, 9, 10), { name: 'Zeide', type: 'yahrtzeit', yearsAgo: 9 })],
    });
    expect(d.counts).toEqual({ today: 1, tonight: 0, later_this_week: 0, week_ahead: 0 });
    expect(d.today[0].text).toBe("Zeide Levi's 9th yahrzeit");
  });
});

describe('the "Later in the week" block — Sundays only', () => {
  it('runs tomorrow through Saturday on a Sunday', () => {
    const d = digest(SUNDAY, {
      events: [
        eventOn(day(2026, 9, 13), { name: 'Dina', yearsAgo: 42 }),
        eventOn(day(2026, 9, 16), { name: 'Noam', yearsAgo: 4 }),
        eventOn(day(2026, 9, 19), { name: 'Sara', yearsAgo: 7 }), // Saturday — the last day in
        eventOn(day(2026, 9, 20), { name: 'NextWeek', yearsAgo: 1 }), // next Sunday — out
      ],
      gatherings: [gatheringOn('2026-09-13', { gather_time: '18:30' })],
    });

    expect(d.is_sunday).toBe(true);
    expect(d.counts).toEqual({ today: 2, tonight: 0, later_this_week: 2, week_ahead: 0 });
    expect(d.later_this_week.map(l => l.date)).toEqual(['2026-09-16', '2026-09-19']);
    expect(d.message).toBe(
      '🗓️ *Today in the family* — Sunday, September 13\n' +
        '\n' +
        "🎂 Dina Levi's 42nd birthday\n" +
        '🕍 Cohen wedding · 6:30 PM\n' +
        '\n' +
        '*Later in the week:*\n' +
        "🎂 Wed, Sep 16 — Noam Levi's 4th birthday\n" +
        "🎂 Sat, Sep 19 — Sara Levi's 7th birthday\n" +
        '\n' +
        `See it all 👉 ${SITE}`
    );
  });

  it('is omitted on a Sunday with nothing later in the week', () => {
    const d = digest(SUNDAY, { events: [eventOn(day(2026, 9, 13), { name: 'Dina' })] });
    expect(d.is_sunday).toBe(true);
    expect(d.later_this_week).toEqual([]);
    expect(d.message).not.toContain('Later in the week');
  });

  it('never appears on a weekday, however full the week is', () => {
    const d = digest(THURSDAY, {
      events: [
        eventOn(day(2026, 9, 10), { name: 'Dina' }),
        eventOn(day(2026, 9, 12), { name: 'Later' }),
      ],
    });
    expect(d.is_sunday).toBe(false);
    expect(d.later_this_week).toEqual([]);
    expect(d.message).not.toContain('Later in the week');
  });

  it('does not repeat a yahrzeit already named in "Tonight begins"', () => {
    const d = digest(SUNDAY, {
      events: [eventOn(day(2026, 9, 14), { name: 'Yaakov', type: 'yahrtzeit', yearsAgo: 9 })],
    });
    expect(d.counts).toEqual({ today: 0, tonight: 1, later_this_week: 0, week_ahead: 0 });
    expect(d.message).toContain('Tonight begins');
    expect(d.message).not.toContain('Later in the week');
    // The name is said exactly once in the whole broadcast.
    expect(d.message.match(/Yaakov Levi/g)).toHaveLength(1);
  });

  it('does not repeat an occasion already named in "Today"', () => {
    // Hebrew birthday today, fixed civil birthday on Wednesday — one mention.
    const row = eventOn(day(2026, 9, 13), { name: 'Dina', english: '1984-09-16' });
    const d = digest(SUNDAY, { events: [row] });
    expect(d.counts).toEqual({ today: 1, tonight: 0, later_this_week: 0, week_ahead: 0 });
    expect(d.message.match(/Dina Levi/g)).toHaveLength(1);
  });

  it('reaches into the next civil year when the week crosses New Year', () => {
    const d = digest(new Date('2026-12-27T06:00:00Z'), {
      // 08:00 Jerusalem (UTC+2 in winter) on Sunday Dec 27 2026.
      events: [eventOn(day(2027, 1, 1), { name: 'Chana', yearsAgo: 30 })],
    });
    expect(d.date).toBe('2026-12-27');
    expect(d.is_sunday).toBe(true);
    expect(d.later_this_week.map(l => l.date)).toEqual(['2027-01-01']);
    expect(d.message).toContain("🎂 Fri, Jan 1 — Chana Levi's 30th birthday");
  });
});

describe('an empty day', () => {
  it('has no content and no message at all, so the job sends nothing', () => {
    const d = digest(THURSDAY);
    expect(d.has_content).toBe(false);
    expect(d.message).toBe('');
    expect(d.today).toEqual([]);
    expect(d.tonight).toEqual([]);
    expect(d.later_this_week).toEqual([]);
    expect(d.counts).toEqual({ today: 0, tonight: 0, later_this_week: 0, week_ahead: 0 });
  });

  it('is empty on a Sunday too when the whole week is clear', () => {
    const d = digest(SUNDAY, { events: [eventOn(day(2026, 9, 22), { name: 'NextWeek' })] });
    expect(d.has_content).toBe(false);
    expect(d.message).toBe('');
  });
});

describe('the family/deployment timezone decides "today" and "Sunday"', () => {
  const events = [
    eventOn(day(2026, 9, 13), { name: 'Sunday', yearsAgo: 1 }),
    eventOn(day(2026, 9, 14), { name: 'Monday', yearsAgo: 2 }),
  ];

  it('turns the day over at Jerusalem midnight, not at UTC midnight', () => {
    // 21:00Z Sep 12 is already Sunday Sep 13 in Jerusalem.
    const at = new Date('2026-09-12T21:00:00Z');
    const jerusalem = buildDailyDigest({ events, siteUrl: SITE, now: at, timeZone: TZ });
    const utc = buildDailyDigest({ events, siteUrl: SITE, now: at, timeZone: 'UTC' });

    expect(jerusalem.date).toBe('2026-09-13');
    expect(jerusalem.is_sunday).toBe(true);
    expect(jerusalem.counts).toEqual({ today: 1, tonight: 0, later_this_week: 1, week_ahead: 0 });

    // Reckoned in UTC the same instant is still Saturday: Sunday's birthday has
    // not arrived, the Sunday look-ahead does not apply, and the family would be
    // sent nothing at all. This is the bug the zone argument exists to prevent.
    expect(utc.date).toBe('2026-09-12');
    expect(utc.is_sunday).toBe(false);
    expect(utc.counts).toEqual({ today: 0, tonight: 0, later_this_week: 0, week_ahead: 0 });
    expect(utc.has_content).toBe(false);
    expect(jerusalem.has_content).toBe(true);
  });

  it('holds the day until the last minute before Jerusalem midnight', () => {
    const lastMinute = buildDailyDigest({
      events, siteUrl: SITE, now: new Date('2026-09-13T20:59:59Z'), timeZone: TZ,
    });
    const justAfter = buildDailyDigest({
      events, siteUrl: SITE, now: new Date('2026-09-13T21:00:00Z'), timeZone: TZ,
    });
    expect(lastMinute.date).toBe('2026-09-13');
    expect(lastMinute.is_sunday).toBe(true);
    expect(justAfter.date).toBe('2026-09-14');
    expect(justAfter.is_sunday).toBe(false);
    // Monday's event is "today" on Monday and was "tonight" the evening before.
    expect(justAfter.counts.today).toBe(1);
    expect(lastMinute.counts.today).toBe(1);
    expect(lastMinute.today[0].text).toContain('Sunday Levi');
    expect(justAfter.today[0].text).toContain('Monday Levi');
  });

  it('reports the zone it reasoned in', () => {
    expect(digest(SUNDAY).timezone).toBe(TZ);
    expect(buildDailyDigest({ events: [], siteUrl: SITE, now: SUNDAY, timeZone: 'UTC' }).timezone)
      .toBe('UTC');
  });
});

describe('newline-injection guard', () => {
  it('cannot be used to add spoofed lines to the broadcast', () => {
    const d = digest(SUNDAY, {
      events: [
        eventOn(day(2026, 9, 13), { name: 'Dina\n💸 Send money to +100', yearsAgo: 42 }),
        eventOn(day(2026, 9, 14), {
          name: 'Yaakov\n🕯️ Fake tonight line', type: 'yahrtzeit', yearsAgo: 9,
        }),
        eventOn(day(2026, 9, 16), { name: 'Noam\nFake later line', yearsAgo: 4 }),
      ],
      gatherings: [
        gatheringOn('2026-09-13', {
          title: 'Wedding\n🕍 Fake wedding',
          location: 'Hall\nFake hall',
        }),
      ],
    });

    // 1 title + 2 today + 3 tonight (heading, name, blessing) + 2 later + 1 link,
    // plus the 4 blank separator lines = a fixed shape no field can grow.
    const lines = d.message.split('\n');
    expect(lines).toHaveLength(13);
    expect(lines.filter(l => l === '')).toHaveLength(4);
    for (const line of d.message.split('\n')) {
      expect(line).not.toMatch(/^(💸|🕍 Fake|Fake)/);
    }
    expect(d.message).toContain('🎂 Dina 💸 Send money to +100 Levi\'s 42nd birthday');
  });
});

describe('defaults', () => {
  it('needs neither gatherings nor an explicit clock', () => {
    const d = buildDailyDigest({ events: [], siteUrl: SITE });
    expect(d.has_content).toBe(false);
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.timezone.length).toBeGreaterThan(0);
  });
});

describe('the week-ahead yahrzeit notice', () => {
  // The retired reminder cron ran TWICE daily: lead=1 (candle lit this evening)
  // and lead=7. Folding in only the eve-before would have quietly deleted the
  // week's notice the moment the old schedule was switched off — and a week is
  // the notice people actually arrange a minyan around.
  it('names a yahrzeit exactly seven days out', () => {
    const d = digest(THURSDAY, {
      events: [eventOn(day(2026, 9, 17), { name: 'Bubbe', type: 'yahrtzeit', yearsAgo: 12 })],
    });
    expect(d.counts.week_ahead).toBe(1);
    expect(d.has_content).toBe(true);
    expect(d.message).toContain('a week away');
    expect(d.message).toContain('Bubbe');
  });

  it('ignores yahrzeits six or eight days out — the notice is exact, like the cron', () => {
    for (const dayOfMonth of [16, 18]) {
      const d = digest(THURSDAY, {
        events: [eventOn(day(2026, 9, dayOfMonth), { name: 'Bubbe', type: 'yahrtzeit' })],
      });
      expect(d.counts.week_ahead).toBe(0);
    }
  });

  it('does not fire for a birthday a week out — yahrzeits only', () => {
    const d = digest(THURSDAY, {
      events: [eventOn(day(2026, 9, 17), { name: 'Dina', yearsAgo: 42 })],
    });
    expect(d.counts.week_ahead).toBe(0);
    expect(d.has_content).toBe(false);
  });

  it('says it once when the Sunday week-view covers the same yahrzeit', () => {
    // From Sunday the 13th, seven days out is Sunday the 20th — outside the
    // Mon–Sat week block, so these cannot collide. Assert the shared de-dup set
    // keeps it that way if either window is ever widened.
    const d = digest(SUNDAY, {
      events: [eventOn(day(2026, 9, 20), { name: 'Zeide', type: 'yahrtzeit', yearsAgo: 9 })],
    });
    const mentions = d.message.split('Zeide').length - 1;
    expect(mentions).toBe(1);
  });

  it('carries the memorial blessing, like the reminder it replaces', () => {
    const d = digest(THURSDAY, {
      events: [eventOn(day(2026, 9, 17), { name: 'Bubbe', type: 'yahrtzeit' })],
    });
    expect(d.message).toContain('May their memory be a blessing');
  });
});
