import Link from 'next/link';
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { auditEvents, type AuditableEvent } from '@/lib/date-consistency';
import { cleanName } from '@/lib/names';
import { DateProblemList } from './DateProblemList';

export const dynamic = 'force-dynamic';

/**
 * Date check — the owner-facing data-health report.
 *
 * Every event carries two independently-stored dates (a recurring Hebrew day/month
 * and an original Gregorian date) and the calendar renders both. Rows entered
 * through the app agree by construction — the form derives the Hebrew date from the
 * English one — but rows IMPORTED from a family spreadsheet have two hand-typed
 * columns, and a typo in either survives silently forever. This page finds those.
 *
 * Owner-only: the proxy coarse-gates /admin/* on the cached role and requireAdmin()
 * re-verifies it live AND establishes the tenant context the query() below needs,
 * so the report can only ever cover the caller's own family.
 */
export default async function DatesPage() {
  await requireAdmin();

  const rows = await query<AuditableEvent>(
    `SELECT e.id,
            m.name AS person_name,
            e.event_type,
            e.hebrew_day,
            e.hebrew_month,
            e.original_english_date::text AS original_english_date
       FROM family_calendar.events e
       JOIN family_calendar.family_members m ON m.id = e.family_member_id
      ORDER BY m.name`
  );

  // ::text above is deliberate — the pg driver hands back a DATE as a JS Date at
  // local midnight, and formatting that back to a day is exactly how this database
  // once acquired 38 birthdays that were one day early. Keep the string a string.
  const report = auditEvents(
    rows.map(r => ({ ...r, person_name: cleanName(r.person_name) }))
  );
  const { summary, problems, adarChoices } = report;
  const checked = summary.ok + summary.nightfall + summary.mismatch + summary.adar_convention;

  return (
    <div className="min-h-screen bg-parchment">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink transition-colors">
          ← Calendar
        </Link>
        <h1 className="font-display text-3xl text-ink mt-3 mb-1">Date check</h1>
        <p className="text-ink-muted text-sm mb-6">
          Every birthday and anniversary here has both a Hebrew date and an English date. They
          should describe the same day. This page converts one to the other and shows you any that
          disagree — almost always a typo in whichever list the dates were first written down in.
        </p>

        <dl className="grid grid-cols-3 gap-3 mb-8 text-center">
          <Stat value={checked} label="cross-checked" />
          <Stat value={summary.mismatch} label="disagree" emphasis={summary.mismatch > 0} />
          <Stat value={summary.no_english} label="no English date" />
        </dl>

        {summary.mismatch === 0 && summary.unconvertible === 0 ? (
          <p className="border-y border-warm-border py-6 text-center text-sm text-ink-muted">
            {checked === 0
              ? 'Nothing to check yet — add some birthdays and come back.'
              : adarChoices.length > 0
                ? 'No typos found. There is one leap-year question below.'
                : 'Every date agrees. Nothing to fix. 🎉'}
          </p>
        ) : (
          <DateProblemList problems={problems} />
        )}

        {adarChoices.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl text-ink mb-1">A leap-year Adar question</h2>
            <p className="text-ink-muted text-sm mb-4">
              {adarChoices.length === 1 ? 'This event falls' : 'These events fall'} on the same day
              of the month as recorded — but in a leap year, which has two Adars, and the two dates
              point at different ones. <strong className="text-ink-2">Nothing here is mistyped.</strong>{' '}
              This calendar observes a plain &ldquo;Adar&rdquo; occasion in{' '}
              <strong className="text-ink-2">Adar II</strong>. If your family observes it in the
              first Adar instead, open the person on the family tree and set the month explicitly to
              &ldquo;Adar I&rdquo;. Otherwise leave it — it is already doing what it should.
            </p>
            <div className="border-y border-warm-border divide-y divide-warm-border/60">
              {adarChoices.map(a => (
                <div key={a.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink">{a.person_name}</span>
                    <span className="label shrink-0">{a.event_type}</span>
                  </div>
                  <p className="text-xs text-ink-muted mt-1">
                    Recorded as <span className="text-ink-2">{a.stored_hebrew}</span>; the English
                    date <span className="text-ink-2">{a.stored_english}</span> was{' '}
                    <span className="text-ink-2">{a.english_falls_on}</span>.
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 space-y-3 text-xs text-ink-faint">
          <p>
            <strong className="text-ink-muted">A one-day difference is not an error</strong> and is
            not listed here. The Hebrew day begins at nightfall, so someone born on a Tuesday
            evening has a Tuesday English birthday and a Wednesday Hebrew one. Only gaps of two days
            or more are shown.
          </p>
          {summary.no_english > 0 && (
            <p>
              {summary.no_english}{' '}
              {summary.no_english === 1 ? 'event has' : 'events have'} no English date recorded, so
              there is nothing to cross-check. That is fine — the Hebrew date is all this calendar
              needs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  emphasis = false,
}: {
  value: number;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border border-warm-border rounded-md py-3">
      <dd className={`font-display text-2xl ${emphasis ? 'text-accent' : 'text-ink'}`}>{value}</dd>
      <dt className="label mt-0.5">{label}</dt>
    </div>
  );
}
