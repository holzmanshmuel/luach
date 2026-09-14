import { describe, it, expect } from 'vitest';
import { systemQuery, query } from '@/lib/db';
import { deleteFamilies } from '@/test-stubs/families';
import { runWithTenant } from '@/lib/tenant';
import { setEventEnglishDate, setEventHebrewDate } from '@/lib/date-corrections';

/**
 * These statements reached production without ever having been executed by
 * anything. They lived inside a server action, which cannot run in a test without
 * a request and a session, so the suite was green while both UPDATEs were broken:
 *
 *   column "gregorian_year" is of type integer but expression is of type text
 *
 * In `CASE WHEN col IS NULL THEN NULL ELSE $n END` the only other branch is an
 * untyped NULL, so Postgres has nothing to infer the parameter's type from and
 * settles on text. Every one of these tests would have caught it on the first run.
 *
 * Requires DATABASE_URL pointing at a Postgres with the migrations applied, as
 * `app_user`, so the RLS the isolation test relies on is genuinely live.
 */

async function makeFamily(name: string): Promise<number> {
  const [row] = await systemQuery<{ id: number }>(
    'INSERT INTO family_calendar.families (name) VALUES ($1) RETURNING id',
    [name]
  );
  return row.id;
}

/** A member + one event, with `withYears` deciding whether the year columns are set. */
async function makeEvent(
  familyId: number,
  withYears: boolean
): Promise<{ memberId: number; eventId: number }> {
  return runWithTenant(familyId, async () => {
    const [member] = await query<{ id: number }>(
      `INSERT INTO family_calendar.family_members (name, family_branch, family_id)
       VALUES ('Test Person', 'Other', $1) RETURNING id`,
      [familyId]
    );
    const [event] = await query<{ id: number }>(
      `INSERT INTO family_calendar.events
         (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year,
          original_english_date, gregorian_year, family_id)
       VALUES ($1, 'birthday', 12, 'Sivan', $2, '1978-06-07', $3, $4)
       RETURNING id`,
      [member.id, withYears ? 5738 : null, withYears ? 1978 : null, familyId]
    );
    return { memberId: member.id, eventId: event.id };
  });
}

async function readEvent(familyId: number, eventId: number) {
  return runWithTenant(familyId, async () => {
    const [row] = await query<{
      hebrew_day: number;
      hebrew_month: string;
      hebrew_year: number | null;
      original_english_date: string | null;
      gregorian_year: number | null;
    }>(
      `SELECT hebrew_day, hebrew_month, hebrew_year,
              original_english_date::text AS original_english_date, gregorian_year
         FROM family_calendar.events WHERE id = $1`,
      [eventId]
    );
    return row;
  });
}

async function cleanup(familyId: number) {
  await deleteFamilies(familyId);
}

describe('setEventEnglishDate', () => {
  it('writes the date and keeps gregorian_year in step', async () => {
    const familyId = await makeFamily('DateFix EN Family');
    try {
      const { eventId } = await makeEvent(familyId, true);
      const changed = await runWithTenant(familyId, () =>
        setEventEnglishDate(eventId, '1978-06-17')
      );
      expect(changed).toBe(1);

      const row = await readEvent(familyId, eventId);
      expect(row.original_english_date).toBe('1978-06-17');
      expect(row.gregorian_year).toBe(1978);
    } finally {
      await cleanup(familyId);
    }
  });

  it('leaves gregorian_year NULL when the row never had one', async () => {
    const familyId = await makeFamily('DateFix EN NullYear Family');
    try {
      const { eventId } = await makeEvent(familyId, false);
      await runWithTenant(familyId, () => setEventEnglishDate(eventId, '1978-06-17'));
      const row = await readEvent(familyId, eventId);
      expect(row.original_english_date).toBe('1978-06-17');
      expect(row.gregorian_year).toBeNull();
    } finally {
      await cleanup(familyId);
    }
  });

  it('carries a year change across the civil-year boundary', async () => {
    const familyId = await makeFamily('DateFix EN Boundary Family');
    try {
      const { eventId } = await makeEvent(familyId, true);
      await runWithTenant(familyId, () => setEventEnglishDate(eventId, '1979-01-02'));
      const row = await readEvent(familyId, eventId);
      expect(row.gregorian_year).toBe(1979);
    } finally {
      await cleanup(familyId);
    }
  });
});

describe('setEventHebrewDate', () => {
  it('writes day, month and hebrew_year together', async () => {
    const familyId = await makeFamily('DateFix HE Family');
    try {
      const { eventId } = await makeEvent(familyId, true);
      const changed = await runWithTenant(familyId, () =>
        setEventHebrewDate(eventId, 2, 'Sivan', 5738)
      );
      expect(changed).toBe(1);

      const row = await readEvent(familyId, eventId);
      expect(row.hebrew_day).toBe(2);
      expect(row.hebrew_month).toBe('Sivan');
      expect(row.hebrew_year).toBe(5738);
    } finally {
      await cleanup(familyId);
    }
  });

  it('leaves hebrew_year NULL when the row never had one', async () => {
    const familyId = await makeFamily('DateFix HE NullYear Family');
    try {
      const { eventId } = await makeEvent(familyId, false);
      await runWithTenant(familyId, () => setEventHebrewDate(eventId, 2, 'Sivan', 5738));
      const row = await readEvent(familyId, eventId);
      expect(row.hebrew_day).toBe(2);
      expect(row.hebrew_year).toBeNull();
    } finally {
      await cleanup(familyId);
    }
  });

  it('accepts a multi-word month name', async () => {
    // "Adar I" / "Adar II" are real stored values; a text cast must not mangle them.
    const familyId = await makeFamily('DateFix HE Adar Family');
    try {
      const { eventId } = await makeEvent(familyId, true);
      await runWithTenant(familyId, () => setEventHebrewDate(eventId, 15, 'Adar II', 5757));
      const row = await readEvent(familyId, eventId);
      expect(row.hebrew_month).toBe('Adar II');
    } finally {
      await cleanup(familyId);
    }
  });
});

describe('tenant isolation', () => {
  it('changes nothing when the event belongs to another family', async () => {
    const mine = await makeFamily('DateFix Mine');
    const theirs = await makeFamily('DateFix Theirs');
    try {
      const { eventId } = await makeEvent(theirs, true);

      // Acting inside MY family, with THEIR event id: RLS must match no row.
      const changed = await runWithTenant(mine, () =>
        setEventEnglishDate(eventId, '1999-01-01')
      );
      expect(changed).toBe(0);

      const untouched = await readEvent(theirs, eventId);
      expect(untouched.original_english_date).toBe('1978-06-07');
    } finally {
      await cleanup(mine);
      await cleanup(theirs);
    }
  });
});
