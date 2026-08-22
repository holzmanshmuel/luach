/**
 * Shared UI class strings (holzman-ai "Signal" brand: underline inputs, mono
 * labels, pill buttons). SINGLE SOURCE OF TRUTH for these constants.
 *
 * This module has NO `'use client'` directive on purpose. These are plain
 * strings, needed by both Server Components (e.g. the /login page) and Client
 * Components. When a `'use client'` module (like Modal.tsx) re-exports a value
 * and a Server Component imports it *through* that client module, the value
 * crosses the client→server boundary as a client reference — not the literal
 * string — so at render time the className resolves to a non-string and the
 * classes silently vanish. Keeping the constants in this server-safe module and
 * importing them from HERE in server code fixes that at the root; Modal.tsx
 * re-exports these so client components have one import site too.
 */

/**
 * Where this app's source lives. Linked from the footer and the welcome page so
 * anyone who wants to run their own copy can find it in one click.
 */
export const REPO_URL = 'https://github.com/holzmanshmuel/luach';

export const fieldLabel = 'label block mb-1.5';

export const fieldInput =
  'w-full bg-transparent border-b border-warm-border focus:border-accent py-2 text-ink placeholder:text-ink-faint outline-none transition-colors';

export const btnPrimary =
  'sig-primary inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50 transition-colors';

export const btnGhost =
  'inline-flex items-center justify-center rounded-full border border-warm-border text-ink px-5 py-2.5 text-sm hover:bg-parchment-dark transition-colors';
