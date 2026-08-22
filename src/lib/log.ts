/**
 * Minimal structured error logging.
 *
 * Emits a single-line JSON object to `console.error` so Railway (which captures
 * stdout/stderr) ingests it as one structured event, greppable by `context`.
 * Kept deliberately tiny — no external logging dependency for launch.
 *
 * NEVER pass secrets or raw token VALUES in `err`/`extra`. If a token must be
 * correlated, log only a short prefix (see `tokenPrefix`).
 */
export function logError(
  context: string,
  err: unknown,
  extra?: Record<string, unknown>
): void {
  const base: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: 'error',
    context,
  };

  if (err instanceof Error) {
    base.message = err.message;
    if (err.stack) base.stack = err.stack;
  } else if (err !== undefined) {
    base.message = String(err);
  }

  const record = { ...base, ...extra };

  try {
    console.error(JSON.stringify(record));
  } catch {
    // Circular refs in `extra` would break JSON.stringify — never let logging
    // throw and mask the original error. Fall back to a plain line.
    console.error(`[${context}]`, base.message ?? err);
  }
}

/**
 * Safe way to reference a secret token in logs: at most the first `max` chars
 * (default 8), never the whole value. Use ONLY when a prefix genuinely aids
 * debugging — otherwise omit the token entirely.
 */
export function tokenPrefix(token: string | null | undefined, max = 8): string {
  if (!token) return '';
  return token.slice(0, max);
}
