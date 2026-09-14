import { describe, it, expect } from 'vitest';
import { keyedDenial, OWNER_ONLY } from './action-errors';
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
