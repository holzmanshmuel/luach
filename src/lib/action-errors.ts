import type { TMessage } from './translations';

/** What an owner-only admin action reports when the live owner check fails. */
export const OWNER_ONLY: TMessage = { key: 'admin.err.owner_only' };

/**
 * Give `withAdminOrError()`'s denial the same shape as the action's own errors.
 *
 * The admin pages' Server Actions return {@link TMessage} errors, so the client can
 * translate them and `<bdi>`-isolate the data inside them. `withAdminOrError()` is
 * shared by every owner action and reports a denial as a plain English string; this
 * maps that one shape onto a key and passes the action's own result through
 * untouched. It is a result mapper, not a second auth wrapper — the check itself
 * still happens in lib/auth.ts, exactly once.
 *
 * Sound because an action wrapped this way never returns a STRING error of its own.
 * Pure: no auth import, so it is testable without a session.
 */
export function keyedDenial<T extends { error?: TMessage }>(
  result: T | { error: string }
): T | { error: TMessage } {
  return typeof (result as { error?: unknown }).error === 'string'
    ? { error: OWNER_ONLY }
    : (result as T);
}

/*
 * ── THE SOFT MEMBER GUARDS' DENIALS ──
 *
 * withEditor() / withDeleter() refuse in WORDS rather than throwing, so the person
 * who cannot do the thing is told why instead of getting a 500. Those words reach
 * the screen verbatim, which is why they are constants rather than literals at the
 * call sites — and why they live HERE, beside the keys they map to, rather than in
 * lib/auth.ts: two copies of a user-facing sentence drift apart silently.
 *
 * lib/auth.ts imports them. This module stays pure (a type-only translations
 * import), so the mapping is testable without a session or a database.
 */
export const NOT_SIGNED_IN = 'Please sign in.';
export const NOT_A_MEMBER = 'You are not a member of this family.';
export const VIEW_ONLY = 'You have view-only access.';
export const OWNER_ONLY_DELETE = 'Only the family owner can delete things.';

/** The generic "it did not save" message — the fail-closed default, see below. */
export const SAVE_FAILED: TMessage = { key: 'err.save_failed' };

/** Each guard denial, keyed. Exhaustive: `keyedMemberDenial` asserts it in tests. */
export const MEMBER_DENIAL: Readonly<Record<string, TMessage>> = {
  [NOT_SIGNED_IN]: { key: 'err.not_signed_in' },
  [NOT_A_MEMBER]: { key: 'err.not_a_member' },
  [VIEW_ONLY]: { key: 'err.view_only' },
  [OWNER_ONLY_DELETE]: { key: 'err.owner_only_delete' },
};

/**
 * {@link keyedDenial} for the soft member guards, which have four denials rather
 * than one — "sign in", "not your family", "view-only", "owner deletes only" — and
 * each has to keep its own meaning, because they ask the reader for four different
 * things.
 *
 * Fails CLOSED on a sentence it does not recognise: an unmapped string becomes the
 * generic {@link SAVE_FAILED} rather than being passed through. A reworded denial
 * then reads as vague instead of leaking English into a right-to-left page — the
 * failure this exists to prevent. The test pins the mapping so "vague" stays a
 * theoretical fallback rather than what anyone actually sees.
 */
export function keyedMemberDenial<T extends { error?: TMessage }>(
  result: T | { error: string }
): T | { error: TMessage } {
  const error = (result as { error?: unknown }).error;
  if (typeof error !== 'string') return result as T;
  // Object.hasOwn, not `?? SAVE_FAILED`: a plain object literal inherits
  // Object.prototype, so MEMBER_DENIAL['constructor'] is a FUNCTION and
  // MEMBER_DENIAL['__proto__'] is an object — both truthy, neither a TMessage,
  // and both crash <Message> on `t(undefined)` rather than falling back. No caller
  // can pass such a string today; the guard is here so none ever can.
  return { error: Object.hasOwn(MEMBER_DENIAL, error) ? MEMBER_DENIAL[error] : SAVE_FAILED };
}
