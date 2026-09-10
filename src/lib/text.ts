/**
 * Collapse a user-controlled string to a single safe line for embedding into a
 * multi-line broadcast message (WhatsApp digests/reminders).
 *
 * User-editable fields (member names, gathering title/location/description,
 * event_type_label) are interpolated verbatim into a newline-delimited message
 * that is then sent to the family's phones. Two separate ways a field can lie:
 *
 *  1. **Newlines** let an editor inject extra spoofed lines into the broadcast —
 *     a title of "Kiddush\n🕯️ Yahrzeit for someone" reads as two real entries.
 *     Every C0/C1 control and DEL becomes a space, runs collapse, ends trimmed.
 *
 *  2. **Bidirectional overrides** let text lie about its own order. A single
 *     U+202E (RIGHT-TO-LEFT OVERRIDE) reverses everything after it, so a name or
 *     location can be made to render as something quite different from what is
 *     stored — and in a Hebrew/English calendar, where mixed-direction text is
 *     completely normal, nobody would think twice. These characters are INVISIBLE,
 *     so a reviewer reading the message cannot see why it renders wrongly.
 *     Stripped outright rather than replaced: they carry no visible content.
 *
 * What is deliberately KEPT: ordinary Hebrew and Arabic letters (their direction
 * comes from the characters themselves, which is correct and needed), emoji, and
 * every printable mark. This strips control, not language.
 */

/**
 * Explicit Unicode bidirectional formatting characters.
 *
 * The overrides and embeddings (U+202A–U+202E), the isolates (U+2066–U+2069),
 * and the deprecated marks U+200E/U+200F. Written as escapes on purpose: typed
 * literally they would be invisible in this source file, which is the entire
 * problem being fixed.
 */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Zero-width characters, which can hide or split text without being seen. */
const ZERO_WIDTH = /[\u200b\u200c\u200d\ufeff]/g;

export function oneLine(s: string): string {
  return s
    // C0 controls (incl. CR/LF/TAB), DEL, and C1 controls -> space, then collapse.
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    // Direction and zero-width controls carry no visible text: remove, never pad.
    .replace(BIDI_CONTROLS, "")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();
}
