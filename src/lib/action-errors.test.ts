import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  keyedDenial,
  keyedMemberDenial,
  MEMBER_DENIAL,
  NOT_A_MEMBER,
  NOT_SIGNED_IN,
  OWNER_ONLY,
  OWNER_ONLY_DELETE,
  SAVE_FAILED,
  VIEW_ONLY,
} from './action-errors';
import { T, type TMessage } from './translations';

describe('keyedDenial', () => {
  it('turns withAdminOrError’s English denial into a translatable key', () => {
    // withAdminOrError() is shared by every owner action and says "Admin access
    // required." in English. On a bilingual page that has to become a key.
    expect(keyedDenial({ error: 'Admin access required.' })).toEqual({ error: OWNER_ONLY });
    expect(T.en[OWNER_ONLY.key]).toBeDefined();
    expect(T.he[OWNER_ONLY.key]).toBeDefined();
  });

  it('passes an action’s own result through untouched', () => {
    const ownError = { error: { key: 'dates.err.stale' } };
    expect(keyedDenial(ownError)).toBe(ownError);
    const saved: { error?: TMessage; branches?: string[] } = { branches: ['Levi', 'Other'] };
    expect(keyedDenial(saved)).toBe(saved);
    const nothing = {};
    expect(keyedDenial(nothing)).toBe(nothing);
  });
});

/**
 * The soft member guards (withEditor / withDeleter) report a refusal in words
 * rather than throwing, and those words reach the screen. keyedMemberDenial is
 * what stops them reaching a Hebrew screen in English.
 */
describe('keyedMemberDenial', () => {
  it('turns every denial the guards can return into a translatable key', () => {
    for (const [sentence, message] of Object.entries(MEMBER_DENIAL)) {
      expect(keyedMemberDenial({ error: sentence })).toEqual({ error: message });
      // Word-for-word, not merely present: an English reader must keep getting the
      // sentence the guard actually returns. Asserting only that the key EXISTS
      // would let the table drift away from auth.ts in silence.
      expect(T.en[message.key], `${message.key} has drifted from the guard's wording`).toBe(
        sentence
      );
      expect(T.he[message.key], `${message.key} missing from the Hebrew table`).toBeDefined();
    }
  });

  it('covers all four denials, and each keeps its own meaning', () => {
    expect(Object.keys(MEMBER_DENIAL).sort()).toEqual(
      [NOT_SIGNED_IN, NOT_A_MEMBER, VIEW_ONLY, OWNER_ONLY_DELETE].sort()
    );
    const keys = Object.values(MEMBER_DENIAL).map(m => m.key);
    expect(new Set(keys).size, 'four distinct reasons, four distinct sentences').toBe(4);
  });

  it('never lets an English sentence through, even one it has never seen', () => {
    // Fails CLOSED. If a denial is reworded in auth.ts and nobody adds a key here,
    // the owner still gets a translated sentence rather than English inside an RTL
    // page — the exact failure this whole mechanism exists to prevent.
    expect(keyedMemberDenial({ error: 'Some new English refusal.' })).toEqual({
      error: SAVE_FAILED,
    });
    expect(T.en[SAVE_FAILED.key]).toBeDefined();
    expect(T.he[SAVE_FAILED.key]).toBeDefined();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'does not mistake the inherited %s for a denial',
    inherited => {
      // A plain object literal inherits Object.prototype, so a bare lookup answers
      // these with an object or a function — truthy, so `?? SAVE_FAILED` never
      // fires, and the non-message reaches <Message> and crashes the render.
      const out = keyedMemberDenial({ error: inherited }) as { error: TMessage };
      expect(out).toEqual({ error: SAVE_FAILED });
      expect(typeof out.error.key).toBe('string');
    }
  );

  it('passes an action’s own result through untouched', () => {
    const ownError = { error: { key: 'err.name_clash', params: { name: 'Dina Levi' } } };
    expect(keyedMemberDenial(ownError)).toBe(ownError);
    const nothing = {};
    expect(keyedMemberDenial(nothing)).toBe(nothing);
  });

  it('is the only copy of the wording — lib/auth.ts imports it', () => {
    // Two copies of a user-facing sentence drift, and the drift is invisible: the
    // guard refuses, the mapper does not recognise its own wording, and the reader
    // gets the generic fallback instead of the reason.
    const auth = readFileSync(fileURLToPath(new URL('./auth.ts', import.meta.url)), 'utf8');
    for (const sentence of Object.keys(MEMBER_DENIAL)) {
      expect(auth.includes(`'${sentence}'`), `${sentence} is spelled out again in auth.ts`).toBe(
        false
      );
    }
    expect(auth).toMatch(/from '@\/lib\/action-errors'/);
  });
});
