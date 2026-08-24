import { describe, it, expect } from 'vitest';
import { T, getT, Lang } from '@/lib/translations';

/**
 * getT() falls back to English for any key missing from the Hebrew table
 * (`T[lang][key] ?? T['en'][key] ?? key`). That fallback is good runtime
 * behaviour and a terrible failure mode to ship: a forgotten Hebrew string
 * renders as English inside an otherwise-Hebrew, RTL page, and nothing errors.
 *
 * These are pure table checks — no database, so they run everywhere.
 */
describe('translation tables', () => {
  it('every English key has a Hebrew counterpart, and vice versa', () => {
    const en = Object.keys(T.en).sort();
    const he = Object.keys(T.he).sort();
    expect(he.filter(k => !(k in T.en))).toEqual([]); // Hebrew-only strays
    expect(en.filter(k => !(k in T.he))).toEqual([]); // the fallback trap
  });

  it('no Hebrew value is left as the English placeholder text', () => {
    const untranslated = Object.keys(T.en).filter(
      k => T.he[k] !== undefined && T.he[k] === T.en[k] && /[a-zA-Z]{4,}/.test(T.en[k])
    );
    expect(untranslated).toEqual([]);
  });
});

/**
 * The iCal feed is the one surface that cannot read the `lang` cookie (calendar
 * apps send no cookies), so its language arrives as `?lang=` and its strings are
 * whole-title templates rather than assembled words — Hebrew takes no
 * possessive 's, so "{name}'s Hebrew Birthday" has no word-by-word equivalent.
 * A template that loses its placeholder still renders, just without the name.
 */
describe('iCal feed strings', () => {
  const TITLE_KEYS = [
    'ical.title.hebrew.birthday',
    'ical.title.hebrew.anniversary',
    'ical.title.hebrew.yahrtzeit',
    'ical.title.hebrew.other',
    'ical.title.english_birthday',
  ];

  it.each(['en', 'he'] as Lang[])('%s title templates all carry {name}', lang => {
    for (const key of TITLE_KEYS) {
      expect(T[lang][key], `${lang}/${key} missing`).toBeDefined();
      expect(T[lang][key], `${lang}/${key} lost its {name} placeholder`).toContain('{name}');
    }
  });

  it.each(['en', 'he'] as Lang[])('%s generic template also carries {type}', lang => {
    expect(T[lang]['ical.title.hebrew.other']).toContain('{type}');
  });

  it('Hebrew feed strings are genuinely translated, not English fallbacks', () => {
    const icalKeys = Object.keys(T.en).filter(k => k.startsWith('ical.'));
    expect(icalKeys.length).toBeGreaterThan(0);
    const fellBack = icalKeys.filter(k => getT('he')(k) === getT('en')(k));
    expect(fellBack).toEqual([]);
  });
});
