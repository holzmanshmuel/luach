import { EventType } from './types';

/**
 * Single source of truth for how each event type is presented across the app
 * (calendar chips, legend, upcoming list, On-This-Day, iCal). Previously this
 * mapping was duplicated in EventCard, CalendarLegend, OnThisDay and ical.ts.
 *
 * Colors come from the design-system tokens in globals.css:
 *   birthday → gold · anniversary → clay · yahrtzeit → slate · other → olive
 */
export const EVENT_STYLE: Record<
  EventType,
  { icon: string; labelKey: string; dot: string; text: string }
> = {
  birthday:    { icon: '🎂', labelKey: 'event.birthday',    dot: 'bg-ev-birthday',    text: 'text-ev-birthday' },
  anniversary: { icon: '💍', labelKey: 'event.anniversary', dot: 'bg-ev-anniversary', text: 'text-ev-anniversary' },
  yahrtzeit:   { icon: '🕯️', labelKey: 'event.yahrtzeit',   dot: 'bg-ev-yahrzeit',    text: 'text-ev-yahrzeit' },
  other:       { icon: '📅', labelKey: 'event.other',       dot: 'bg-ev-other',       text: 'text-ev-other' },
};

export function eventStyle(type: EventType) {
  return EVENT_STYLE[type] ?? EVENT_STYLE.other;
}

/**
 * Distinct light background tints per event type, so each kind of event is
 * instantly distinguishable on the calendar. Birthdays split further by which
 * calendar the occurrence belongs to (Hebrew vs Gregorian), since each birthday
 * appears on both. Colours are deliberately different hues — amber, sky, rose,
 * slate, violet — chosen to read clearly with dark text and not be confused.
 */
export function eventTint(
  type: EventType,
  dateType: 'hebrew' | 'gregorian' = 'gregorian',
): { bg: string; border: string } {
  if (type === 'birthday') {
    return dateType === 'hebrew'
      ? { bg: '#E0F2FE', border: '#BAE6FD' }  // sky — Hebrew birthday (pairs with ✡)
      : { bg: '#FEF3C7', border: '#FDE68A' }; // amber — Gregorian birthday (pairs with ☀)
  }
  switch (type) {
    case 'anniversary': return { bg: '#FFE4E6', border: '#FECDD3' }; // rose
    // Warm taupe — deliberately a warm neutral so it can't be confused with the
    // cool sky tint of a Hebrew birthday (the two were near-identical before, and
    // indistinguishable for colour-blind users).
    case 'yahrtzeit':   return { bg: '#EAE0D2', border: '#D6C5AC' }; // taupe — memorial
    default:            return { bg: '#EDE9FE', border: '#DDD6FE' }; // violet — other
  }
}

/** Icon-only lookup, for places that just need the glyph. */
export const EVENT_ICONS: Record<EventType, string> = {
  birthday: '🎂',
  anniversary: '💍',
  yahrtzeit: '🕯️',
  other: '📅',
};
