/**
 * The app's public origin (e.g. https://family-calendar.holzman-ai.com).
 *
 * Behind Railway's proxy, `request.url` resolves to the internal bind address
 * (0.0.0.0:8080), which breaks absolute redirects (magic links, the webcal feed).
 * Prefer the configured public URL, then the forwarded host, then the raw URL.
 */
export function publicOrigin(request: Request): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/+$/, '');
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (fwdHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${fwdHost}`;
  }
  return new URL(request.url).origin;
}
