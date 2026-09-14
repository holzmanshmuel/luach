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
