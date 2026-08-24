export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateICalFeed } from '@/lib/ical';
import { Lang } from '@/lib/translations';
import { familyIdForFeedToken } from '@/lib/feed-token';
import { runWithTenant } from '@/lib/tenant';

/**
 * The subscribable iCal feed. Calendar apps can't send cookies, so src/proxy.ts
 * allowlists this path — the token in the URL is the WHOLE authorization
 * decision, and it must therefore also decide the tenant.
 *
 * Each family has its own `families.feed_token` (migrate-v13), so the presented
 * token IDENTIFIES the family it belongs to. There is deliberately no `family=`
 * parameter: the old shared-ICAL_TOKEN design let anyone holding one feed URL
 * swap the id and read any other family's calendar. A `family=` param on an
 * inbound URL is simply ignored (old subscriptions keep working, minus the
 * cross-tenant read). The legacy master token grants nothing — ICAL_TOKEN is no
 * longer read anywhere in the app.
 *
 * ## Language
 *
 * `?lang=he` renders the feed in Hebrew; anything else (including absent) is
 * English. It has to be a query parameter: calendar apps don't send cookies, so
 * the `lang` cookie the rest of the app localizes from cannot reach this route.
 * The subscribe URL handed to a user already carries their current language, so
 * this is normally invisible.
 *
 * Language is deliberately NOT part of the VEVENT UID (those are row id + day,
 * see src/lib/ical.ts). Re-subscribing in the other language therefore updates
 * the existing entries in place rather than duplicating the whole calendar.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const lang: Lang = request.nextUrl.searchParams.get('lang') === 'he' ? 'he' : 'en';
  const familyId = await familyIdForFeedToken(token);
  // Fail CLOSED, and identically for "no token" and "unknown token" — a distinct
  // status would let a caller probe which tokens (or families) exist.
  if (familyId === null) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const icalString = await runWithTenant(familyId, () => generateICalFeed(lang));
    return new NextResponse(icalString, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="family-calendar.ics"',
        'Cache-Control': 'public, max-age=3600',
        'X-Published-TTL': 'PT1H',
      },
    });
  } catch (err) {
    console.error('iCal generation error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
