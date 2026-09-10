/**
 * Sanitize a caller-supplied `?next=` / `?from=` redirect target.
 *
 * Open-redirect defense: we only ever redirect to a SAME-ORIGIN path. A value is
 * accepted only when it is a path starting with a single '/' that cannot be
 * normalized into a cross-origin destination.
 *
 * ── WHY THIS IS NOT JUST TWO startsWith CHECKS ──
 * It used to be, and that was exploitable in production. **The URL parser strips
 * ASCII tab (%09), CR (%0D) and LF (%0A) from anywhere in a URL before resolving
 * it** — a WHATWG requirement browsers and Node both implement. So a value like
 * `/<TAB>/evil.com` passes a `startsWith('//')` test, because at that moment it
 * genuinely begins `/` then `<TAB>`; the parser then removes the tab, leaving
 * `//evil.com`, and `new URL(next, origin)` resolves it to `https://evil.com/`.
 * Confirmed live: `/api/logout?next=%2F%09%2Fevil.com` returned
 * `Location: https://evil.com/`.
 *
 * That mattered beyond the logout link. The same sanitizer gates
 * `/api/auth/google?next=`, the OAuth callback's post-login redirect and
 * `/login?from=`, so a crafted link could carry someone through a genuine Google
 * sign-in and then bounce them to an attacker's page — arriving from the real
 * calendar, which is exactly what makes a phishing page believable.
 *
 * The fix is to stop pattern-matching the raw string and instead ask the same
 * parser the redirect will use, then require the answer to be same-origin.
 *
 * Returns the sanitized path (with any query and fragment preserved), or null
 * when the input is unsafe or absent.
 */

/** Characters the URL parser deletes wherever they appear. */
const URL_STRIPPED = /[\t\r\n]/g;

export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next) return null;

  // Normalize the way a parser will: remove what it would remove, so every check
  // below reasons about the string that will ACTUALLY be resolved, not the one
  // that was typed. Then reject any remaining C0 control or DEL: those have no
  // business in a path we generated. A SPACE is deliberately allowed — the parser
  // percent-encodes it rather than dropping it, so it cannot smuggle in an
  // authority component, and a path may legitimately contain one.
  const normalized = next.replace(URL_STRIPPED, '');
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;

  if (!normalized.startsWith('/')) return null;
  if (normalized.startsWith('//') || normalized.startsWith('/\\')) return null;

  // Belt and braces: resolve it exactly as the redirect will, against a throwaway
  // origin, and require it to have stayed on that origin. A string that survives
  // the checks above but still escapes — through some normalization we have not
  // thought of — is caught here rather than in production.
  const PROBE_ORIGIN = 'https://sanitize-next.invalid';
  try {
    const resolved = new URL(normalized, PROBE_ORIGIN);
    if (resolved.origin !== PROBE_ORIGIN) return null;
    // Hand back the parser's own view of the path, so what we return is what the
    // browser would go to.
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
