// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { T, type Lang } from '@/lib/translations';
import { MEMBER_DENIAL, VIEW_ONLY } from '@/lib/action-errors';
import { EditPersonModal } from './EditPersonModal';

/**
 * # Saving a person when an action never answers
 *
 * The modal fires up to four Server Actions and awaited them with `Promise.all`,
 * which rejects on the FIRST rejection. Two failures came out of that. A rejected
 * action — a dropped connection, a 500, an action that throws instead of returning
 * `{ error }` — took the whole transition down with it, so **nothing appeared**:
 * no banner, the modal still open, the click looking like it had done nothing. And
 * when two calls failed differently, the rejection discarded whatever the others
 * had answered, hiding a reason the person could actually have acted on.
 *
 * These drive a real click (jsdom — a static render cannot reach a state that only
 * exists after Save) and assert what is on the screen afterwards.
 *
 * Every name below is fictional.
 */

const env = vi.hoisted(() => ({
  lang: 'en' as Lang,
  /** What updatePersonAction does: answer cleanly, answer with a refusal, or reject. */
  person: 'ok' as 'ok' | 'refuse' | 'reject',
  /** What setHebrewNameAction does — the SECOND call, so two can fail differently. */
  hebrew: 'ok' as 'ok' | 'refuse' | 'reject',
  closed: 0,
}));

vi.mock('@/app/actions', () => ({
  // The three loaders the modal calls on mount.
  getAllFamilyMembers: async () => [
    { id: 2, name: 'Yaakov Cohen', nickname: null, family_branch: 'Cohen' },
  ],
  getPersonRelationships: async () => ({ parentIds: [], spouseIds: [] }),
  getPersonById: async () => ({
    phone_e164: null,
    notifications_enabled: false,
    maiden_name: null,
    last_name: 'Levi',
    name_he: 'דינה לוי',
  }),
  // The save path.
  updatePersonAction: async () => {
    if (env.person === 'reject') throw new Error('connection reset');
    if (env.person === 'refuse') return { error: 'Another family member is already named “Dina Levi”.' };
    return {};
  },
  updatePersonRelationshipsAction: async () => ({}),
  updatePersonPhotoAction: async () => ({}),
  setHebrewNameAction: async () => {
    if (env.hebrew === 'reject') throw new Error('connection reset');
    if (env.hebrew === 'refuse') return { error: MEMBER_DENIAL[VIEW_ONLY] };
    return {};
  },
}));

vi.mock('./UserPrefsContext', async () => {
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
      branches: ['Levi', 'Cohen', 'Other'],
      branchVariants: {},
      chosen: {},
      spell: (b?: string | null) => b ?? '',
      setSpelling: () => {},
    }),
  };
});

const PERSON = {
  id: 1,
  name: 'Dina Levi',
  last_name: 'Levi',
  name_he: 'דינה לוי',
  nickname: null,
  maiden_name: null,
  family_branch: 'Levi',
  photo_url: null,
};

let container: HTMLDivElement;
let root: Root;
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  env.lang = 'en';
  env.person = 'ok';
  env.hebrew = 'ok';
  env.closed = 0;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  logged.mockRestore();
  act(() => root.unmount());
  container.remove();
});

/**
 * Type into a React-controlled input. Setting `.value` directly is invisible to
 * React — it caches the last value on the DOM node — so go through the native
 * setter and then fire the event React actually listens for.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Render the modal for `lang`, wait for its loaders, then submit. Returns the visible text. */
async function save(lang: Lang, edit?: (c: HTMLElement) => void): Promise<string> {
  env.lang = lang;
  await act(async () => {
    root.render(<EditPersonModal person={PERSON} onClose={() => { env.closed += 1; }} />);
  });
  if (edit) await act(async () => { edit(container); });
  const form = container.querySelector('form');
  expect(form, 'expected the edit form').not.toBeNull();
  await act(async () => {
    form!.requestSubmit();
  });
  return document.body.textContent ?? '';
}

/**
 * Make the save fire a SECOND action as well as `updatePersonAction`. The modal
 * only calls each action when its field actually changed, so a save with nothing
 * edited is a single call — and a test written against that could never see two
 * failures race. Editing the Hebrew name adds `setHebrewNameAction`.
 */
function editHebrewName(c: HTMLElement) {
  const input = [...c.querySelectorAll('input')].find(i => i.getAttribute('dir') === 'rtl');
  expect(input, 'expected the Hebrew-name input').toBeTruthy();
  typeInto(input as HTMLInputElement, 'דינה לוי הכהן');
}

describe('EditPersonModal — a save that never answers', () => {
  it.each(['en', 'he'] as Lang[])('says so in %s instead of looking like nothing happened', async lang => {
    env.person = 'reject';
    const text = await save(lang);

    expect(text).toContain(T[lang]['err.save_failed']);
    // …and the modal stays open, because nothing was reliably saved.
    expect(env.closed, 'a failed save must not close the modal').toBe(0);
    // The reader gets a sentence; the trace is not thrown away with it.
    expect(logged).toHaveBeenCalled();
  });

  it('prefers a reason the person can act on over the generic one', async () => {
    // Two calls, failing differently: the name is refused (actionable) while the
    // Hebrew-name save dies on the wire. Under Promise.all the rejection won and
    // the refusal was discarded — the person was told to reload the page rather
    // than to pick another name.
    env.person = 'refuse';
    env.hebrew = 'reject';
    const text = await save('en', editHebrewName);

    expect(text).toContain('Another family member is already named');
    expect(text).not.toContain(T.en['err.save_failed']);
    expect(env.closed).toBe(0);
  });

  it('shows a refusal that only the second action returned', async () => {
    // Nothing rejects here: the name saves and the Hebrew spelling is refused by
    // the editor guard. Its TMessage is flattened for this modal's plain-string
    // banner, so a Hebrew reader still gets Hebrew.
    env.lang = 'he';
    env.hebrew = 'refuse';
    const text = await save('he', editHebrewName);

    expect(text).toContain(T.he['err.view_only']);
    expect(text).not.toContain(T.en['err.view_only']);
    expect(env.closed).toBe(0);
  });

  it('still closes on a clean save', async () => {
    await save('en', editHebrewName);
    expect(env.closed).toBe(1);
  });
});
