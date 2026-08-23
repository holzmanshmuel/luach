import { getSession } from '@/lib/auth';
import { getMembership } from '@/lib/users';
import { publicOrigin } from '@/lib/base-url';
import { feedTokenForFamily } from '@/lib/feed-token';
import { cookies } from 'next/headers';

export interface SubscribeUrls {
  httpsUrl: string;
  webcalUrl: string;
}

/**
 * The calendar-subscription URLs for the signed-in user's ACTIVE family, or null
 * when the caller isn't entitled to them (caller renders that as 401).
 *
 * Shared by /api/subscribe (307 redirect) and /api/subscribe/info (JSON) so the
 * two can't drift — they hand out the same secret at the same trust level.
 *
 * Three deliberate choices:
 *
 *  - **The ACTIVE family, never the combined-view set.** `session.viewFamilyIds`
 *    can hold several families (merged read-only view), but a feed URL carries
 *    exactly one family's token, so the subscription always follows
 *    `session.familyId` — the family the switcher is currently on.
 *  - **Live membership re-check.** src/proxy.ts gates these paths on the cookie
 *    having *some* userId + familyId; that's a coarse gate, and the cached
 *    values survive a member being removed. Since this route mints a long-lived
 *    credential for a family's whole calendar, it re-reads the membership from
 *    the DB first — the same verify-before-you-trust discipline as
 *    establishTenant()/requireAuth() and the /api/family/switch route.
 *  - **No `family=` in the URL.** The token identifies its family (migrate-v13);
 *    /api/calendar.ics ignores any family param.
 *  - **`lang=he` is baked in for Hebrew users.** Calendar apps don't send
 *    cookies, so the feed can't read the `lang` cookie the way the rest of the
 *    app does — the language has to travel in the URL itself. English is the
 *    default and is left implicit, so existing subscriptions are byte-identical.
 */
export async function subscribeUrlsForSession(request: Request): Promise<SubscribeUrls | null> {
  const session = await getSession();
  if (!session.userId || !session.familyId) return null;

  const membership = await getMembership(session.userId, session.familyId);
  if (!membership) return null;

  const feedToken = await feedTokenForFamily(session.familyId);
  if (!feedToken) return null;

  const cookieStore = await cookies();
  const langSuffix = cookieStore.get('lang')?.value === 'he' ? '&lang=he' : '';

  const httpsUrl =
    publicOrigin(request) +
    `/api/calendar.ics?token=${encodeURIComponent(feedToken)}${langSuffix}`;
  return { httpsUrl, webcalUrl: httpsUrl.replace(/^https?:/, 'webcal:') };
}
