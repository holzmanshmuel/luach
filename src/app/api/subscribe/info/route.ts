import { subscribeUrlsForSession } from '@/lib/subscribe-urls';

// Returns the calendar subscription URLs for the Subscribe instructions dialog.
// Same trust level and same guards as the /api/subscribe redirect (both go
// through subscribeUrlsForSession): the URLs carry the ACTIVE family's own feed
// token and are only ever handed to a verified live member of that family.
export async function GET(request: Request) {
  const urls = await subscribeUrlsForSession(request);
  if (!urls) return new Response('Unauthorized', { status: 401 });
  return Response.json(urls);
}
