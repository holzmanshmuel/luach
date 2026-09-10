export const dynamic = 'force-dynamic';

import { CalendarGrid } from '@/app/components/CalendarGrid';
import { HebrewCalendarGrid } from '@/app/components/HebrewCalendarGrid';
import { UpcomingEvents } from '@/app/components/UpcomingEvents';
import { MonthNav } from '@/app/components/MonthNav';
import { CalendarLegend } from '@/app/components/CalendarLegend';
import { OnThisDay } from '@/app/components/OnThisDay';
import { WelcomeBanner } from '@/app/components/WelcomeBanner';
import { JoinedBanner } from '@/app/components/JoinedBanner';
import { Header } from '@/app/components/Header';
import { CombinedModeProvider } from '@/app/components/CombinedModeProvider';
import { getSession, getSessionInfo, requireAuth } from '@/lib/auth';
import { getMembershipsForUser } from '@/lib/users';
import { getGatherings } from '@/app/actions';
import { getHolidaysForMonth, getHolidaysForHebrewMonth } from '@/lib/holidays';
import { getZmanimForMonth, getZmanimForHebrewMonth } from '@/lib/zmanim';
import { buildHebrewMonth, getHebrewMonthForGregorian } from '@/lib/hebrew-calendar';
import {
  getEventsForMonth,
  getEventsForHebrewMonth,
  getUpcomingEvents,
  getGatheringsRaw,
  dbMonthLabels,
} from '@/lib/calendar-data';
import { resolveViewFamilies, mapAcrossFamilies, tagWith } from '@/lib/combined';
import { familyLabel } from '@/lib/family-label';
import type { CalendarEvent, FamilyTag, Gathering } from '@/lib/types';
import { civilDayInZone, todayYmd } from '@/lib/zoned-day';
import { civilMonthIndex, civilYear } from '@/lib/civil-day';
import { cookies } from 'next/headers';

/** Parse a numeric URL param, falling back to a default if missing/NaN/out-of-range. */
function intParam(v: string | undefined, def: number, min: number, max: number): number {
  const n = v != null ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

/**
 * The switcher's checked set: the VALIDATED combined-view families (resolveViewFamilies()
 * already filtered these to the user's live memberships) when combined mode is active,
 * else just the single active family — so a plain (non-combined) session shows only its
 * own family checked, never an empty or stale list, and a revoked membership can't leave
 * a stale checkbox checked.
 */
function resolveSelectedIds(combined: boolean, viewFamilies: FamilyTag[], activeFamilyId: number | null): number[] {
  if (combined) return viewFamilies.map(f => f.id);
  return activeFamilyId !== null ? [activeFamilyId] : [];
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    year?: string;
    hmonth?: string;
    hyear?: string;
    /** Set once by the invite redemption action — see JoinedBanner. */
    joined?: string;
  }>;
}) {
  // Establish tenant context BEFORE any tenant-scoped query() runs. Must be at the
  // top level of the page fn (awaited here) — NOT folded into the Promise.all
  // below, because enterTenant() uses AsyncLocalStorage.enterWith(): a sibling
  // promise in the same Promise.all does not inherit a store entered by another
  // sibling. The proxy already redirects signed-out traffic to /login, so real
  // users never hit this throw; it's the fail-closed backstop.
  await requireAuth();

  // Combined-view resolution: which families to merge (empty/single ⇒ plain
  // single-family behavior, byte-for-byte unchanged below).
  const view = await resolveViewFamilies();
  const combined = view?.mode === 'combined';
  const viewFamilies = view?.mode === 'combined' ? view.families : [];

  const params = await searchParams;
  const cookieStore = await cookies();
  const lang = cookieStore.get('lang')?.value === 'he' ? 'he' : 'en';

  // Cheap system-scoped lookup (not tenant data) for the family switcher — every
  // membership row for this user, so the header can offer the others. `userId`
  // is guaranteed set here: requireAuth() above already confirmed a live session.
  const { userId, familyId } = await getSession();
  const memberships = await getMembershipsForUser(userId!);

  // ?joined=1 is the ONLY confirmation a relative gets that redeeming their invite
  // worked. Resolved here, above the two render branches, because this file returns
  // twice — a Hebrew-month grid and a Gregorian one — and putting it in only one of
  // them would leave Hebrew readers (or English ones) with no confirmation at all.
  const joinedFamily =
    params.joined === '1' ? memberships.find(m => m.family_id === familyId) : undefined;
  const joinedLabel = joinedFamily
    ? familyLabel(lang, joinedFamily.family_name, joinedFamily.family_name_he)
    : null;

  // ── "Today", decided ONCE, here, in the deployment's timezone ──
  // Every grid and nav below is a CLIENT component; each used to call `new Date()`
  // in the browser, so a relative in Auckland saw the highlight on tomorrow's cell
  // and one in Los Angeles on yesterday's. It travels down as a YYYY-MM-DD string,
  // which no clock can reinterpret.
  const todayDay = todayYmd();

  // ── Hebrew mode: Hebrew-month grid ──
  if (lang === 'he') {
    const todayHeb = getHebrewMonthForGregorian(civilDayInZone());
    const hMonth = intParam(params.hmonth, todayHeb.hebrewMonth, 1, 13);
    const hYear = intParam(params.hyear, todayHeb.hebrewYear, 5000, 6000);
    const model = buildHebrewMonth(hMonth, hYear);

    let hebEvents: CalendarEvent[], upcomingAll: CalendarEvent[], gatherings: Gathering[];
    if (combined) {
      const bundles = await mapAcrossFamilies(viewFamilies, async (fam) => ({
        events: (await getEventsForHebrewMonth(dbMonthLabels(hMonth, hYear), hYear, model)).map(tagWith(fam)),
        upcoming: (await getUpcomingEvents(50)).map(tagWith(fam)),
        gatherings: (await getGatheringsRaw()).map(tagWith(fam)),
      }));
      hebEvents = bundles.flatMap(b => b.events);
      upcomingAll = bundles.flatMap(b => b.upcoming)
        .sort((a, b) => (a.gregorianDay < b.gregorianDay ? -1 : a.gregorianDay > b.gregorianDay ? 1 : 0));
      gatherings = bundles.flatMap(b => b.gatherings);
    } else {
      [hebEvents, upcomingAll, gatherings] = await Promise.all([
        getEventsForHebrewMonth(dbMonthLabels(hMonth, hYear), hYear, model),
        getUpcomingEvents(50),
        getGatherings(),
      ]);
    }
    const sessionInfo = await getSessionInfo();

    const holidaysRaw = getHolidaysForHebrewMonth(hMonth, hYear);
    const holidays: Record<number, { name: string; yomTov: boolean; chutzLaaretz: boolean }> = {};
    for (const [d, h] of Object.entries(holidaysRaw)) {
      holidays[Number(d)] = { name: h.nameHe, yomTov: h.yomTov, chutzLaaretz: h.chutzLaaretz };
    }
    // Candle-lighting / havdalah times (Jerusalem) — family-independent, so
    // computed once and shared across the combined view too.
    const zmanim = getZmanimForHebrewMonth(model);

    return (
      <CombinedModeProvider combined={combined} viewFamilies={viewFamilies}>
        <div className="min-h-screen bg-parchment">
          <Header
            lang="he"
            isAdmin={sessionInfo.role === 'owner'}
            memberships={memberships}
            activeFamilyId={sessionInfo.familyId}
            selectedIds={resolveSelectedIds(combined, viewFamilies, sessionInfo.familyId)}
          />
          <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">
              {joinedLabel && <JoinedBanner lang={lang} familyLabel={joinedLabel} />}
              <WelcomeBanner />
              <OnThisDay events={upcomingAll} />
              <MonthNav todayDay={todayDay} hebrew={{ model, hMonth, hYear, isCurrent: hMonth === todayHeb.hebrewMonth && hYear === todayHeb.hebrewYear }} />
              <CalendarLegend />
              <HebrewCalendarGrid model={model} events={hebEvents} gatherings={gatherings} holidays={holidays} zmanim={zmanim} todayDay={todayDay} />
            </div>
            <aside className="w-full lg:w-72 shrink-0">
              <UpcomingEvents events={upcomingAll.slice(0, 10)} />
            </aside>
          </div>
        </div>
      </CombinedModeProvider>
    );
  }

  // ── English mode: Gregorian-month grid (unchanged baseline) ──
  // The default month is the deployment's current one — read off `todayDay`, not
  // a fresh `new Date()`, so the page and its "today" ring never disagree.
  const year = intParam(params.year, civilYear(todayDay), 1900, 2200);
  const month = intParam(params.month, civilMonthIndex(todayDay), 0, 11);

  let events: CalendarEvent[], upcomingAll: CalendarEvent[], gatherings: Gathering[];
  if (combined) {
    const bundles = await mapAcrossFamilies(viewFamilies, async (fam) => ({
      events: (await getEventsForMonth(year, month)).map(tagWith(fam)),
      upcoming: (await getUpcomingEvents(50)).map(tagWith(fam)),
      gatherings: (await getGatheringsRaw()).map(tagWith(fam)),
    }));
    events = bundles.flatMap(b => b.events);
    upcomingAll = bundles.flatMap(b => b.upcoming)
      .sort((a, b) => (a.gregorianDay < b.gregorianDay ? -1 : a.gregorianDay > b.gregorianDay ? 1 : 0));
    gatherings = bundles.flatMap(b => b.gatherings);
  } else {
    [events, upcomingAll, gatherings] = await Promise.all([
      getEventsForMonth(year, month), getUpcomingEvents(50), getGatherings(),
    ]);
  }
  const sessionInfo = await getSessionInfo();
  const upcomingEvents = upcomingAll.slice(0, 10);
  const nextThirtyDaysEvents = upcomingAll;

  const holidaysRaw = getHolidaysForMonth(year, month);
  const holidays: Record<number, { name: string; yomTov: boolean; chutzLaaretz: boolean }> = {};
  for (const [d, h] of Object.entries(holidaysRaw)) {
    holidays[Number(d)] = { name: h.name, yomTov: h.yomTov, chutzLaaretz: h.chutzLaaretz };
  }
  // Candle-lighting / havdalah times (Jerusalem) — family-independent.
  const zmanim = getZmanimForMonth(year, month);

  return (
    <CombinedModeProvider combined={combined} viewFamilies={viewFamilies}>
      <div className="min-h-screen bg-parchment">
        <Header
          lang="en"
          isAdmin={sessionInfo.role === 'owner'}
          memberships={memberships}
          activeFamilyId={sessionInfo.familyId}
          selectedIds={resolveSelectedIds(combined, viewFamilies, sessionInfo.familyId)}
        />
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            {joinedLabel && <JoinedBanner lang={lang} familyLabel={joinedLabel} />}
            <WelcomeBanner />
            <OnThisDay events={nextThirtyDaysEvents} />
            <MonthNav year={year} month={month} todayDay={todayDay} />
            <CalendarLegend />
            <CalendarGrid year={year} month={month} events={events} gatherings={gatherings} holidays={holidays} zmanim={zmanim} todayDay={todayDay} />
          </div>
          <aside className="w-full lg:w-72 shrink-0">
            <UpcomingEvents events={upcomingEvents} />
          </aside>
        </div>
      </div>
    </CombinedModeProvider>
  );
}
