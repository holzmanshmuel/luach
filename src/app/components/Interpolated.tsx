import { splitTemplate } from '@/lib/translations';

/**
 * Render a translated whole-sentence template with ONE value substituted in, with
 * the value wrapped in `<bdi>` so the bidi algorithm cannot reorder it.
 *
 * The values these sentences carry — a family name, a signed-in email address — are
 * frequently Latin script inside a Hebrew RTL page. `<bdi>` isolates each one and
 * auto-detects its direction, which is right for both a Latin and a Hebrew family
 * name without the caller having to know which it got. The rest of the app already
 * uses `<bdi>` for exactly this (see EventDetailModal, OrgChart).
 *
 * No `'use client'`: this is a plain function component, usable from Server
 * Components (where every caller here lives) and from client ones.
 */
export function Interpolated({
  template,
  placeholder,
  value,
}: {
  template: string;
  placeholder: string;
  value: string;
}) {
  const [before, after] = splitTemplate(template, placeholder);
  return (
    <>
      {before}
      <bdi>{value}</bdi>
      {after}
    </>
  );
}
