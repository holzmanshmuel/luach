// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { T, type Lang, type TMessage } from '@/lib/translations';
import { MEMBER_DENIAL, SAVE_FAILED, VIEW_ONLY } from '@/lib/action-errors';
import { ReviewNamesPanel } from './ReviewNamesPanel';

/**
 * # A refused save on /admin/names, in the owner's language
 *
 * `setHebrewNameAction` used to answer a refusal with an English sentence, and the
 * panel dropped it on the floor: a viewer-role member (or a signed-out tab left
 * open overnight) clicked Confirm and **nothing happened** — no error, no change,
 * no hint that the row had not been saved.
 *
 * So the assertion here is not "the action returns a key". It is what the person
 * at the screen gets: click Confirm, the save is refused, and the reason appears
 * **in their own language**, with no English left in the Hebrew page. This is the
 * only test in the suite that drives a real click — every other component test
 * renders statically, and a static render can never reach an error that only
 * exists after an interaction. Hence the jsdom environment in the docblock above.
 *
 * Every name below is fictional.
 */

const env = vi.hoisted(() => ({
  lang: 'he' as Lang,
  result: {} as { error?: TMessage },
  /** When true the action REJECTS — a dropped connection, a 500 — rather than answering. */
  rejects: false,
  calls: 0,
}));

// The real action is a Server Action: it pulls in the session, the database and
// next/cache, none of which is what this file is about. What matters is the
// SHAPE of what it answers with, which the fixtures below set per test.
vi.mock('@/app/actions', () => ({
  setHebrewNameAction: async () => {
    env.calls += 1;
    if (env.rejects) throw new Error('connection reset');
    return env.result;
  },
}));

// The real provider needs a Next router. Substitute what the root layout gives a
// signed-in owner for the same `lang` cookie — with the REAL translations, so the
// assertions below read the sentence the owner actually sees.
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
      branches: ['Levi', 'Other'],
      branchVariants: {},
      chosen: {},
      spell: (b?: string | null) => b ?? '',
      setSpelling: () => {},
    }),
  };
});

const ROWS = [
  { id: 1, name: 'Dina Levi', name_he: 'דינה לוי', name_he_status: 'suggested' },
  { id: 2, name: 'Yaakov Cohen', name_he: null, name_he_status: null },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  env.result = {};
  env.rejects = false;
  env.calls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Render the panel for `lang`, then click the first row's Confirm. Returns the visible text. */
async function confirmFirstRow(lang: Lang): Promise<string> {
  env.lang = lang;
  await act(async () => {
    root.render(<ReviewNamesPanel rows={ROWS} />);
  });
  const button = container.querySelector('button');
  expect(button, 'expected a Confirm button on the first row').not.toBeNull();
  await act(async () => {
    button!.click();
  });
  return container.textContent ?? '';
}

/** Latin words a reader could see, once the family's own names are taken out. */
function latinWords(text: string): string[] {
  let rest = text;
  for (const name of ROWS.map(r => r.name)) rest = rest.split(name).join(' ');
  return [...rest.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]);
}

describe('/admin/names — a refused save', () => {
  it.each(['en', 'he'] as Lang[])('tells the owner why, in %s', async lang => {
    // What a viewer-role member gets back from the editor guard.
    env.result = { error: MEMBER_DENIAL[VIEW_ONLY] };
    const text = await confirmFirstRow(lang);

    expect(env.calls).toBe(1);
    expect(text).toContain(T[lang]['err.view_only']);
    // …and the row must NOT claim it saved.
    expect(text).not.toContain(T[lang]['names.confirmed']);
  });

  it('leaves no English in the Hebrew page’s text', async () => {
    // Text nodes only — a leaked English `placeholder`/`title` would slip past
    // this; admin-i18n.test.tsx sweeps the attributes.
    env.result = { error: MEMBER_DENIAL[VIEW_ONLY] };
    const text = await confirmFirstRow('he');
    expect(text).not.toContain(T.en['err.view_only']);
    expect(latinWords(text)).toEqual([]);
  });

  it('points the input at the reason, so tabbing back still explains it', async () => {
    env.result = { error: MEMBER_DENIAL[VIEW_ONLY] };
    await confirmFirstRow('he');
    const input = container.querySelector('input')!;
    const describedBy = input.getAttribute('aria-describedby');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy, 'the refused input should name its error element').toBeTruthy();
    // getElementById, not querySelector: useId() ids look like «r0» and are not
    // valid CSS selectors, and jsdom has no global CSS.escape to fix that up.
    expect(document.getElementById(describedBy!)?.textContent).toBe(T.he['err.view_only']);
  });

  it.each(['en', 'he'] as Lang[])(
    'says so in %s when the action never answers at all',
    async lang => {
      // A rejected Server Action is the shape that looked most like "nothing
      // happened": the transition just ends, and without a catch the row is
      // silently unchanged.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      env.rejects = true;
      const text = await confirmFirstRow(lang);
      expect(text).toContain(T[lang]['err.save_failed']);
      expect(text).not.toContain(T[lang]['names.confirmed']);
      // The reader gets a generic sentence; the trace is not thrown away with it.
      expect(logged).toHaveBeenCalledOnce();
      logged.mockRestore();
    }
  );

  it('clears the error once the save succeeds', async () => {
    env.result = { error: MEMBER_DENIAL[VIEW_ONLY] };
    const refused = await confirmFirstRow('he');
    expect(refused).toContain(T.he['err.view_only']);

    env.result = {};
    const button = container.querySelector('button')!;
    await act(async () => {
      button.click();
    });
    const text = container.textContent ?? '';
    expect(env.calls).toBe(2);
    expect(text).not.toContain(T.he['err.view_only']);
    expect(text).toContain(T.he['names.confirmed']);
  });

  it('shows the reason on the row that was refused, not on every row', async () => {
    env.result = { error: MEMBER_DENIAL[VIEW_ONLY] };
    await confirmFirstRow('he');
    const shown = container.textContent ?? '';
    const occurrences = shown.split(T.he['err.view_only']).length - 1;
    expect(occurrences, 'one refused row, one message').toBe(1);
  });
});

describe('/admin/names — a successful save', () => {
  it('reports the row as confirmed and shows no error', async () => {
    const text = await confirmFirstRow('he');
    expect(text).toContain(T.he['names.confirmed']);
    expect(text).not.toContain(T.he['err.view_only']);
    expect(text).not.toContain(T.he[SAVE_FAILED.key]);
  });
});
