import { subscribeUrlsForSession } from '@/lib/subscribe-urls';

// Authenticated redirect to the webcal subscription URL. The URL carries the
// signed-in user's ACTIVE family's own feed token (migrate-v13), so it is handed
// out in the redirect Location to a verified live member of that family only —
// never rendered into page HTML, and never a shared master token that would open
// every family's calendar. See subscribeUrlsForSession for the guard rationale.
export async function GET(request: Request) {
  const urls = await subscribeUrlsForSession(request);
  if (!urls) return new Response('Unauthorized', { status: 401 });
  return new Response(null, { status: 307, headers: { Location: urls.webcalUrl } });
}
