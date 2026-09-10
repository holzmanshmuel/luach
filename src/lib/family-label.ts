import type { Lang } from '@/lib/translations';

/**
 * The family name to SHOW a reader: the family's Hebrew name when the page is in
 * Hebrew and one was entered, otherwise the Latin name.
 *
 * One place, because this rule now decides what a relative sees on the invite
 * landing page, the join confirmation, the joined banner, the family switcher and
 * /families/new — and a family whose name renders differently on two of those looks
 * like two different families. `name_he` is optional everywhere in the schema, so
 * the Latin name is always the fallback and is never empty.
 */
export function familyLabel(
  lang: Lang,
  name: string,
  nameHe: string | null | undefined
): string {
  return lang === 'he' && nameHe ? nameHe : name;
}
