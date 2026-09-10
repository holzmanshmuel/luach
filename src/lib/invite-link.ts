/**
 * Pull the invite token out of something a relative PASTED.
 *
 * The audience here is somebody reading a link off a spouse's phone, or a link a
 * WhatsApp forward wrapped, truncated or decorated. So we accept a full URL
 * (`https://…/join/<token>`), a bare path (`/join/<token>`), or the bare token, and
 * we never look at the host: a link from a different deployment simply will not
 * resolve on this one, which is the correct outcome rather than something to guess
 * about.
 *
 * Invite tokens are `randomBytes(32).toString('base64url')` — 43 characters of
 * `[A-Za-z0-9_-]` — so the shape check below both validates and stops a pasted
 * sentence from becoming a redirect target. The upper bound keeps a pathological
 * paste out of the URL we build.
 *
 * Returns the token, or null when the paste does not look like one.
 */
export function extractInviteToken(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  // Drop any ?query or #fragment a messaging app appended, then trailing slashes,
  // then take the last path segment.
  const path = trimmed.split(/[?#]/)[0].replace(/\/+$/, '');
  const candidate = path.slice(path.lastIndexOf('/') + 1);

  return /^[A-Za-z0-9_-]{20,128}$/.test(candidate) ? candidate : null;
}
