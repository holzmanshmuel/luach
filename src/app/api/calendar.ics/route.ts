export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateICalFeed } from '@/lib/ical';
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
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const familyId = await familyIdForFeedToken(token);
  // Fail CLOSED, and identically for "no token" and "unknown token" — a distinct
  // status would let a caller probe which tokens (or families) exist.
  if (familyId === null) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const icalString = await runWithTenant(familyId, () => generateICalFeed());
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
