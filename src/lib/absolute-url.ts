/**
 * Build an absolute URL for a route-handler redirect from a TRUSTED public
 * origin — never a raw, attacker-controllable request header.
 *
 * Origin-resolution priority (host-header-injection hardened):
 *   1. NEXTAUTH_URL, if it parses to a valid http(s) URL → use its origin.
 *      This is set in BOTH prod (https://family-calendar.holzman-ai.com) and
 *      dev (http://localhost:3000), so in practice this branch always wins and
 *      any attacker-supplied `x-forwarded-host` is ignored outright.
 *   2. Else `x-forwarded-host` (+ `x-forwarded-proto`) ONLY when the forwarded
 *      host is on a small allowlist (NEXTAUTH_URL's host — if any — plus
 *      localhost:3000 / localhost). An off-allowlist host is ignored so a
 *      spoofed `x-forwarded-host: evil.com` can't become the redirect origin.
 *   3. Else `request.url` (correct in dev, where origins match).
 *
 * The `path` is always preserved verbatim via `new URL(path, resolvedOrigin)`.
 */

/** Parse an env-configured URL, returning null if unset or not a valid http(s) URL. */
function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * The set of hosts we trust in an `x-forwarded-host` header when NEXTAUTH_URL is
 * NOT a usable origin: the NEXTAUTH_URL host (if it parsed) plus the dev hosts.
 */
function allowedForwardedHosts(nextAuthUrl: URL | null): Set<string> {
  const hosts = new Set<string>(['localhost:3000', 'localhost']);
  if (nextAuthUrl) hosts.add(nextAuthUrl.host);
  return hosts;
}

export function absoluteUrl(path: string, request: Request): URL {
  const nextAuthUrl = parseHttpUrl(process.env.NEXTAUTH_URL);

  // 1. Trusted, fixed public URL — always wins when configured. Removes any
  //    influence of attacker-controllable forwarding headers.
  if (nextAuthUrl) {
    return new URL(path, nextAuthUrl.origin);
  }

  // 2. No NEXTAUTH_URL: fall back to x-forwarded-host, but ONLY if it's on the
  //    allowlist. Otherwise ignore the header entirely.
  const fwdHost = request.headers.get('x-forwarded-host');
  if (fwdHost) {
    // A multi-hop proxy chain lists hosts comma-separated, closest-first.
    const host = fwdHost.split(',')[0]!.trim();
    if (host && allowedForwardedHosts(nextAuthUrl).has(host)) {
      const proto = request.headers.get('x-forwarded-proto') ?? 'https';
      return new URL(path, `${proto}://${host}`);
    }
  }

  // 3. Last resort — request.url origin (correct in dev, where origins match).
  return new URL(path, request.url);
}
