/**
 * Sanitize a caller-supplied `?next=` redirect target.
 *
 * Open-redirect defense: we only ever redirect to a SAME-ORIGIN path. A value
 * is accepted only when it is a path that starts with a single '/' and is not a
 * protocol-relative '//host' URL (which the browser would treat as an absolute
 * cross-origin target). Everything else — absolute URLs, protocol-relative
 * URLs, backslash tricks, or anything not starting with '/' — is rejected and
 * the caller falls back to a safe default.
 *
 * Returns the sanitized path, or null when the input is unsafe/absent.
 */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  // Must be an absolute-path reference: exactly one leading '/'.
  if (!next.startsWith('/')) return null;
  // Reject protocol-relative ('//evil.com') and backslash variants ('/\evil.com',
  // '\\evil.com') that browsers can normalize into a cross-origin destination.
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}
