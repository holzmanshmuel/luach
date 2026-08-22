/**
 * The app's public origin, resolved from an INBOUND request (e.g.
 * https://calendar.example.com).
 *
 * Behind a proxy, `request.url` resolves to the internal bind address
 * (0.0.0.0:8080), which breaks absolute redirects (magic links, the webcal feed).
 * Prefer the configured public URL, then the forwarded host, then the raw URL.
 *
 * Only safe where a request exists AND the result is handed straight back to
 * that same caller. For links that travel — a WhatsApp digest, an email — use
 * `configuredSiteUrl()` instead: those are read elsewhere, later, so a guess
 * off the request is not good enough.
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

/**
 * The EXPLICITLY CONFIGURED public origin (`NEXTAUTH_URL`), trailing slashes
 * trimmed — or `null` when the variable is unset or blank.
 *
 * For outbound broadcast copy (the weekly digest, the yahrzeit reminder), whose
 * links are opened on a recipient's phone long after the request that generated
 * them. There is no correct guess here, so callers MUST fail loudly — a 500
 * naming this variable — rather than substituting anything.
 *
 * This used to fall back to the maintainer's own hosted instance, which meant a
 * self-hoster who forgot the variable would silently broadcast their family
 * links to somebody else's deployment. Never reintroduce a default.
 */
export function configuredSiteUrl(): string | null {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}
