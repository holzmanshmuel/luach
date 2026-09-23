import { Fragment } from 'react';
import {
  splitTemplate,
  templateParts,
  withoutRepeatedArticle,
  type TMessage,
  type TParam,
  type TParams,
} from '@/lib/translations';

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
      <bdi>{withoutRepeatedArticle(before, value)}</bdi>
      {after}
    </>
  );
}

/**
 * {@link Interpolated} for a sentence carrying SEVERAL values — "Recorded as
 * {hebrew}; the English date {english} was {falls_on}." Every value gets its own
 * `<bdi>`, and the sentence stays one translatable string, so Hebrew is free to put
 * each placeholder wherever its grammar wants it. Never glue two keys together to
 * get the same effect: that presumes English word order.
 *
 * `valueClassName` styles the isolated values (the admin pages set the data a shade
 * darker than the prose around it). A placeholder with no value renders as nothing.
 */
export function InterpolatedMany({
  template,
  params,
  valueClassName,
}: {
  template: string;
  params?: TParams;
  valueClassName?: string;
}) {
  const parts = templateParts(template);
  return (
    <>
      {parts.map((part, i) => {
        if ('text' in part) return <Fragment key={i}>{part.text}</Fragment>;
        const before = parts[i - 1];
        let value = params?.[part.placeholder];
        if (typeof value === 'string' && before && 'text' in before) {
          value = withoutRepeatedArticle(before.text, value);
        }
        return <IsolatedValue key={i} value={value} className={valueClassName} />;
      })}
    </>
  );
}

/** A translated {@link TMessage} — typically a Server Action's error — with its data isolated. */
export function Message({
  t,
  message,
  valueClassName,
}: {
  t: (key: string) => string;
  message: TMessage;
  valueClassName?: string;
}) {
  return (
    <InterpolatedMany template={t(message.key)} params={message.params} valueClassName={valueClassName} />
  );
}

function IsolatedValue({ value, className }: { value: TParam | undefined; className?: string }) {
  if (value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return <bdi className={className}>{value}</bdi>;
  }
  // A list: each item isolated separately, so in RTL the items run right-to-left.
  return (
    <>
      {value.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          <bdi className={className}>{item}</bdi>
        </Fragment>
      ))}
    </>
  );
}
