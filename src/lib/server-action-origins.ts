/**
 * Which origins may invoke Server Actions.
 *
 * ── WHY THIS EXISTS ──
 * Next compares a Server Action request's `origin` header against the host it
 * believes it is serving (`x-forwarded-host`) and aborts on a mismatch — a CSRF
 * defence. Behind a reverse proxy that forwards to an internal hostname those two
 * are ALWAYS different: the browser sends the public domain, the proxy forwards
 * the origin server's own name. Next then rejects EVERY Server Action with
 * "Invalid Server Actions request".
 *
 * In this app that means every edit dies — adding an event, editing a person,
 * saving a phone number, correcting a date — each with a bare "This page couldn't
 * load". Route handlers are untouched, so the site looks perfectly healthy: pages
 * render, sign-in works, the calendar is there. Only writing is dead, and only for
 * whoever tries. That is why it can sit unnoticed for a long time.
 *
 * Pure, and kept out of `next.config.ts` so it can be tested. The config imports it.
 */

/**
 * Resolve the allow-list from the deployment's own environment.
 *
 * `NEXTAUTH_URL` is already required in production and already names the public
 * origin, so a correctly configured deployment is fixed with no new settings.
 * `SERVER_ACTIONS_ALLOWED_ORIGINS` (comma-separated, hosts or full origins) covers
 * a deployment answering on more than one hostname.
 *
 * Returns bare hosts — Next matches on host, not on a whole URL — de-duplicated,
 * order preserved. An empty result means "same origin only", Next's default.
 */
export function resolveServerActionOrigins(
  // Typed loosely on purpose so `process.env` (NodeJS.ProcessEnv, an index
  // signature) is assignable without a cast at the one call site that matters.
  env: Record<string, string | undefined>
): string[] {
  const raw = [env.SERVER_ACTIONS_ALLOWED_ORIGINS, env.NEXTAUTH_URL]
    .filter(Boolean)
    .join(',');

  const hosts = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(toHost)
    .filter((host): host is string => host !== null);

  return [...new Set(hosts)];
}

/**
 * A bare host from either a full origin (`https://example.com/`) or a host that
 * was written without a scheme (`example.com:3000`). Any port is KEPT: Next
 * compares host, and `example.com` and `example.com:3000` are different hosts.
 * Returns null for something that cannot be read as either, so one malformed
 * entry cannot poison the whole list.
 */
function toHost(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host || null;
  } catch {
    return null;
  }
}
