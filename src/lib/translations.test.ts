import { describe, it, expect } from 'vitest';
import { T, getT, splitTemplate, Lang } from '@/lib/translations';

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

/**
 * The sign-in / invite / onboarding copy. Every one of these strings is a WHOLE
 * sentence carrying a named placeholder, never a sentence assembled from two keys —
 * splitting one presumes English word order and makes it untranslatable. So the
 * guard here is that the placeholder survived translation: a Hebrew string that lost
 * its `{family}` renders perfectly and silently stops naming the family.
 */
describe('onboarding & invite copy', () => {
  const FAMILY_KEYS = [
    'invite_land.title',
    'invite_confirm.title',
    'invite_member.title',
    'invite_expired.body',
    'invite_revoked.body',
    'joined.title',
  ];

  it.each(['en', 'he'] as Lang[])('%s strings all keep their {family} placeholder', lang => {
    for (const key of FAMILY_KEYS) {
      expect(T[lang][key], `${lang}/${key} missing`).toBeDefined();
      expect(T[lang][key], `${lang}/${key} lost its {family} placeholder`).toContain('{family}');
    }
  });

  it.each(['en', 'he'] as Lang[])('%s names the signed-in account with {email}', lang => {
    // The point of this string is answering "which Google account am I about to join
    // as?" on a shared family phone. Without the placeholder it answers nothing.
    expect(T[lang]['invite_confirm.signed_in_as']).toContain('{email}');
  });

  it('the whole new copy set is present in both languages and genuinely translated', () => {
    const prefixes = [
      'invite_land.',
      'invite_confirm.',
      'invite_member.',
      'invite_expired.',
      'invite_revoked.',
      'newfamily.',
      'joined.',
    ];
    const keys = Object.keys(T.en).filter(k => prefixes.some(p => k.startsWith(p)));
    expect(keys.length).toBeGreaterThan(20);
    // getT falls back to English for a missing Hebrew key, so identical output means
    // the Hebrew was never written. ('Google' appears in both by design — it is a
    // brand name — so compare whole strings, which differ.)
    expect(keys.filter(k => getT('he')(k) === getT('en')(k))).toEqual([]);
  });

  it('no label starts or ends with a hard-coded directional arrow', () => {
    // A leading '← ' or trailing ' →' is a NAVIGATION arrow, and it points the wrong
    // way the moment the page flips to RTL — 'invite.back' shipped exactly that. Those
    // belong in JSX, chosen from `dir`. (An arrow used mid-string as a step separator,
    // e.g. "Settings → Calendar → Accounts", is a different thing and is left alone.)
    const withArrows = (['en', 'he'] as Lang[]).flatMap(lang =>
      Object.keys(T[lang])
        .filter(k => /^\s*[←→]|[←→]\s*$/.test(T[lang][k]))
        .map(k => `${lang}/${k}`)
    );
    expect(withArrows).toEqual([]);
  });

  it('/welcome no longer carries a second label for the same destination', () => {
    // landing.signin pointed at the IDENTICAL /api/auth/google URL as landing.cta —
    // two labels for one door, which reads as a choice a visitor can get wrong.
    expect(T.en['landing.signin']).toBeUndefined();
    expect(T.he['landing.signin']).toBeUndefined();
    expect(T.en['landing.entry_note']).toBeDefined();
  });
});

describe('splitTemplate', () => {
  it('splits around the placeholder so the value can be direction-isolated', () => {
    expect(splitTemplate('Join the {family} calendar?', 'family')).toEqual([
      'Join the ',
      ' calendar?',
    ]);
  });

  it('handles a placeholder at either end, wherever a language wants it', () => {
    expect(splitTemplate('{family} calendar', 'family')).toEqual(['', ' calendar']);
    expect(splitTemplate('Signed in as {email}', 'email')).toEqual(['Signed in as ', '']);
  });

  it('still renders the sentence when the placeholder is missing', () => {
    // A translation that dropped the placeholder must degrade to a sentence without
    // the value, never to a crash or a literal "{family}" on screen.
    expect(splitTemplate('No placeholder here', 'family')).toEqual(['No placeholder here', '']);
  });

  it('ignores a different placeholder in the same string', () => {
    expect(splitTemplate('{a} and {b}', 'b')).toEqual(['{a} and ', '']);
  });
});
