import type { Lang } from './translations';

interface NameFields {
  name: string;
  last_name?: string | null;
  name_he?: string | null;
  nickname?: string | null;
  maiden_name?: string | null;
  maiden_name_he?: string | null;
}

/** Clean a stored name: drop the "~suffix" disambiguator and stray backslashes. */
export function cleanName(raw: string): string {
  return raw.replace(/~[^~]+$/, '').replace(/\\/g, '').trim();
}
const clean = cleanName;

/**
 * The name to show for a member, given the active language.
 * Hebrew mode prefers name_he (falling back to the English name); English mode
 * uses the English name. Nicknames (when toggled on) win in either language.
 */
/**
 * Split a full name into given name(s) + surname using the last whitespace token
 * as the surname. Single-word names have no surname. Used when a flow only has a
 * single name field (Add Event new-person) and for the one-time backfill.
 */
export function splitFullName(full: string): { given: string; last: string | null } {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given: parts.join(' '), last: null };
  return { given: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** The canonical English full name (given + surname), for feeds/messages that
 *  don't apply the per-viewer spelling or nickname/Hebrew logic. */
export function fullName(m: { name: string; last_name?: string | null }): string {
  const given = clean(m.name);
  const last = m.last_name ? clean(m.last_name) : '';
  return last ? `${given} ${last}` : given;
}

export function displayName(m: NameFields, lang: Lang, showNicknames = false): string {
  if (showNicknames && m.nickname) return clean(m.nickname);
  if (lang === 'he' && m.name_he) return clean(m.name_he);
  // English: given name(s) + surname. last_name is null on not-yet-split legacy
  // rows, in which case `name` already holds the full name — so this is a no-op
  // until the backfill runs.
  const given = clean(m.name);
  const last = m.last_name ? clean(m.last_name) : '';
  return last ? `${given} ${last}`.trim() : given;
}

/** The maiden (birth) surname to show, language-aware. Empty string when none. */
export function maidenName(m: NameFields, lang: Lang): string {
  const raw = lang === 'he' ? (m.maiden_name_he || m.maiden_name) : m.maiden_name;
  return raw ? clean(raw) : '';
}

/**
 * The maiden-name suffix to append after a name, e.g. " (née Cohen)" in
 * English or " (לבית כהן)" in Hebrew. Empty string when no maiden name.
 */
export function maidenSuffix(m: NameFields, lang: Lang): string {
  const maiden = maidenName(m, lang);
  if (!maiden) return '';
  return lang === 'he' ? ` (לבית ${maiden})` : ` (née ${maiden})`;
}
