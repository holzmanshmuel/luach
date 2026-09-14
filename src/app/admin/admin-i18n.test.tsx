import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { T, type Lang } from '@/lib/translations';
import DatesPage from './dates/page';
import BranchesAdminPage from './branches/page';
import NamesPage from './names/page';

/**
 * # The three owner admin pages, rendered for a Hebrew and an English reader
 *
 * `/admin/dates`, `/admin/branches` and `/admin/names` were hardcoded English. The
 * root layout sets `dir="rtl"` for a Hebrew reader, which scrambled them — rows
 * reordered and "← Calendar" came out as "Calendar ←" — so each was pinned to
 * `dir="ltr"`: readable, but an English island in a bilingual app.
 *
 * These tests render the REAL page components (server page + client panel) with the
 * `lang` cookie set, and assert what a reader actually gets: the page direction, a
 * back arrow pointing back the way they came, the copy in their language with no
 * English left in it, the family's data isolated in `<bdi>`, and dates formatted
 * the way the calendar formats them. Only the edges are stubbed — the session, the
 * database rows, and the Server Action modules, which never run in a static render.
 *
 * Every name, branch and date below is fictional.
 */

const env = vi.hoisted(() => ({ lang: 'he' as 'en' | 'he' }));

const fx = vi.hoisted(() => ({
  dateRows: [
    // 12 Sivan with the English day's leading digit dropped: a ten-day mismatch.
    { id: 1, person_name: 'Dina Levi', event_type: 'birthday', hebrew_day: 12, hebrew_month: 'Sivan', original_english_date: '1978-06-07' },
    // Born 1 Adar I, stored as plain Adar: the leap-year question, not a typo.
    { id: 2, person_name: 'Yaakov Cohen', event_type: 'anniversary', hebrew_day: 1, hebrew_month: 'Adar', original_english_date: '1997-02-08' },
    // Nothing to cross-check.
    { id: 3, person_name: 'Rivka Mizrahi', event_type: 'birthday', hebrew_day: 5, hebrew_month: 'Nisan', original_english_date: null },
    { id: 4, person_name: 'Shifra Levi', event_type: 'yahrtzeit', hebrew_day: 9, hebrew_month: 'Av', original_english_date: null },
    // Unreadable as typed.
    { id: 5, person_name: 'Noa Adler', event_type: 'birthday', hebrew_day: 3, hebrew_month: 'Tevet', original_english_date: '17/09/1995' },
  ],
  branches: ['Levi', 'Cohen', 'Mizrahi', 'Other'],
  branchCounts: [
    { branch: 'Levi', n: 3 },
    { branch: 'Cohen', n: 1 },
  ],
  nameRows: [
    { id: 1, name: 'Dina Levi', name_he: 'דינה לוי', name_he_status: 'suggested' },
    { id: 2, name: 'Rivka Mizrahi', name_he: 'רבקה מזרחי', name_he_status: 'confirmed' },
    { id: 3, name: 'Yaakov Cohen', name_he: null, name_he_status: null },
  ],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'lang' ? { name, value: env.lang } : undefined),
  }),
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => {},
  getSession: async () => ({ familyId: 1 }),
}));

vi.mock('@/lib/db', () => ({
  query: async (sql: string) => {
    if (sql.includes('family_calendar.events')) return fx.dateRows;
    if (sql.includes('GROUP BY family_branch')) return fx.branchCounts;
    if (sql.includes('name_he_status')) return fx.nameRows;
    throw new Error(`unexpected query in admin-i18n test: ${sql}`);
  },
  systemQuery: async () => [],
}));

vi.mock('@/lib/branches-server', () => ({
  familyBranches: async () => fx.branches,
  storedFamilyBranches: async () => null,
}));

// Server Action modules: never invoked by a static render, and they pull in the
// database and session chain.
vi.mock('./dates/actions', () => ({
  trustHebrewDateAction: async () => ({}),
  trustEnglishDateAction: async () => ({}),
}));
vi.mock('./branches/actions', () => ({ saveBranchesAction: async () => ({}) }));
vi.mock('@/app/actions', () => ({ setHebrewNameAction: async () => ({}) }));

// The real provider needs a Next router. Substitute what the root layout provides
// for the same `lang` cookie — with the REAL translations.
vi.mock('@/app/components/UserPrefsContext', async () => {
  const { getT } = await import('@/lib/translations');
  return {
    useUserPrefs: () => ({
      language: env.lang,
      showNicknames: false,
      isAdmin: true,
      canEdit: true,
      toggleLanguage: () => {},
      toggleNicknames: () => {},
      t: getT(env.lang),
      branches: fx.branches,
      branchVariants: {},
      chosen: {},
      spell: (b?: string | null) => b ?? '',
      setSpelling: () => {},
    }),
  };
});

async function render(page: () => Promise<ReactElement>, lang: Lang): Promise<string> {
  env.lang = lang;
  return renderToStaticMarkup(await page());
}

/** The inner markup of the link back to the calendar. */
function backLink(html: string): string {
  const m = /<a [^>]*href="\/"[^>]*>(.*?)<\/a>/.exec(html);
  expect(m, 'expected a link back to the calendar').not.toBeNull();
  return m![1];
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Every Latin-letter word a reader could see — page text AND the attributes that
 * surface as text (tooltips, placeholders, screen-reader labels) — once the
 * family's own data has been taken out. On a Hebrew page this must be empty: any
 * word left is an English string that never got translated.
 */
function latinWords(html: string, data: readonly string[]): string[] {
  const attrs = [...html.matchAll(/\s(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[1]);
  let text = decode([html.replace(/<[^>]*>/g, ' '), ...attrs].join(' '));
  for (const d of [...data].sort((a, b) => b.length - a.length)) text = text.split(d).join(' ');
  return [...text.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]);
}

const PAGES = [
  {
    route: '/admin/dates',
    page: DatesPage,
    titleKey: 'dates.title',
    data: [...fx.dateRows.map(r => r.person_name), '17/09/1995'],
  },
  {
    route: '/admin/branches',
    page: BranchesAdminPage,
    titleKey: 'branches.title',
    data: fx.branches,
  },
  {
    route: '/admin/names',
    page: NamesPage,
    titleKey: 'names.title',
    data: fx.nameRows.map(r => r.name),
  },
];

describe.each(PAGES)('$route', ({ page, titleKey, data }) => {
  it('renders right-to-left for a Hebrew reader, entirely in Hebrew', async () => {
    const html = await render(page, 'he');
    // The stopgap pin is gone: the page follows the reader's language.
    expect(html).not.toContain('dir="ltr"');
    expect(html.startsWith('<div dir="rtl"')).toBe(true);
    // Back points the way a right-to-left reader came: to the right.
    expect(backLink(html)).toBe(`<span aria-hidden="true">→</span>${T.he['admin.back']}`);
    expect(html).toContain(T.he[titleKey]);
    expect(latinWords(html, data)).toEqual([]);
  });

  it('renders left-to-right for an English reader, with the arrow pointing left', async () => {
    const html = await render(page, 'en');
    expect(html.startsWith('<div dir="ltr"')).toBe(true);
    expect(backLink(html)).toBe(`<span aria-hidden="true">←</span>${T.en['admin.back']}`);
    expect(html).toContain(T.en[titleKey]);
  });
});

describe('/admin/dates — the data inside the sentences', () => {
  it('formats the dates the way the calendar does, in each language', async () => {
    const he = await render(DatesPage, 'he');
    // The suggested correction and the stored English date, as the Hebrew calendar writes them.
    expect(he).toContain('<bdi class="text-ink-2">17 ביוני 1978</bdi>');
    expect(he).toContain('<bdi class="text-ink-2">7 ביוני 1978</bdi>');
    // The Hebrew date in Hebrew month names, not "12 Sivan".
    expect(he).not.toContain('Sivan');
    expect(he).toContain('סיון');

    const en = await render(DatesPage, 'en');
    expect(en).toContain('<bdi class="text-ink-2">June 17, 1978</bdi>');
    expect(en).toContain('<bdi class="text-ink-2">12 Sivan</bdi>');
  });

  it('isolates every person’s name, and translates the event type', async () => {
    const he = await render(DatesPage, 'he');
    for (const name of ['Dina Levi', 'Yaakov Cohen', 'Noa Adler']) {
      expect(he).toContain(`<bdi>${name}</bdi>`);
    }
    expect(he).toContain(`>${T.he['event.anniversary']}<`);
  });

  it('carries counts and the size of the gap as data inside whole sentences', async () => {
    const he = await render(DatesPage, 'he');
    expect(he).toContain('<bdi class="text-ink-2">10</bdi>'); // ten days earlier
    expect(he).toContain('<bdi>2</bdi>'); // two events with no English date
  });
});

describe('/admin/branches — branch names are the family’s data', () => {
  it('keeps names untranslated, isolated, and in direction-neutral inputs', async () => {
    const he = await render(BranchesAdminPage, 'he');
    for (const b of fx.branches) {
      expect(he, `${b} should be typed into a dir="auto" input`).toMatch(
        new RegExp(`<input dir="auto"[^>]*value="${b}"`)
      );
    }
    // "right now that is Other" — the catch-all named inside a Hebrew sentence.
    expect(he).toContain('<bdi class="italic">Other</bdi>');
    expect(he).toContain(`>${T.he['branches.filed_one']}<`);
    expect(he).toContain('>3 אנשים<');
  });
});

describe('/admin/names', () => {
  it('isolates the stored name and keeps the Hebrew-name input right-to-left', async () => {
    const he = await render(NamesPage, 'he');
    expect(he).toContain('<bdi>Dina Levi</bdi>');
    expect(he).toContain(`placeholder="${T.he['names.placeholder']}"`);
    expect(he).toContain(T.he['names.confirmed']);
    expect(he).toContain(T.he['names.suggested']);
  });
});

/**
 * Source guards, so the next edit cannot quietly reintroduce an English island.
 * The render tests above only see the states a static render reaches; these see the
 * whole file, including the rows shown after a click.
 */
describe('source guards for the admin pages', () => {
  const FILES = [
    'dates/page.tsx',
    'dates/DateProblemList.tsx',
    'branches/page.tsx',
    'branches/BranchesPanel.tsx',
    'names/page.tsx',
    'names/ReviewNamesPanel.tsx',
  ];

  const source = (rel: string) => readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8');

  /** Strip comments, where English prose legitimately explains the code. */
  function stripComments(src: string): string {
    return src
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
  }

  it.each(FILES)('%s does not pin the page direction', rel => {
    expect(stripComments(source(rel))).not.toContain('dir="ltr"');
  });

  it.each(FILES)('%s carries no English copy of its own', rel => {
    const code = stripComments(source(rel));
    // JSX text between tags, and string-literal attributes a reader sees.
    const text = [...code.matchAll(/>([^<>{}();=[\]'"`]*[A-Za-z]{2,}[^<>{}();=[\]'"`]*)</g)].map(m => m[1].trim());
    const attrs = [...code.matchAll(/\b(?:title|placeholder|aria-label|label|alt)="([^"]*[A-Za-z][^"]*)"/g)].map(m => m[0]);
    expect([...text, ...attrs], 'move the copy into translations.ts').toEqual([]);
  });

  it('every translation key the pages and their actions use exists in both languages', () => {
    // getT() falls back to the key itself, so a typo renders "dates.err.stal" on
    // screen and nothing fails. Collect every literal key and check it is real.
    const files = [
      ...FILES,
      'dates/actions.ts',
      'dates/finding-dates.ts',
      'branches/actions.ts',
      '../../lib/branches-server.ts',
      '../../lib/branch-draft.ts',
      '../../lib/action-errors.ts',
    ];
    const keys = new Set<string>();
    for (const rel of files) {
      for (const m of source(rel).matchAll(/'((?:admin|dates|branches|names|err)\.[a-z0-9_.]+)'/g)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(60);
    expect([...keys].filter(k => !(k in T.en) || !(k in T.he))).toEqual([]);
  });
});
