/**
 * Collapse a user-controlled string to a single safe line for embedding into a
 * multi-line broadcast message (WhatsApp digests/reminders).
 *
 * User-editable fields (member names, gathering title/location/description,
 * event_type_label) are interpolated verbatim into a newline-delimited message.
 * Left raw, an editor could smuggle a newline into a field and inject extra
 * spoofed lines. Replacing every control char (CR/LF/TAB and other C0/C1
 * controls) with a single space, then collapsing runs and trimming, removes that
 * vector while keeping the visible text intact.
 */
export function oneLine(s: string): string {
  return s
    // C0 controls (incl. CR/LF/TAB), DEL, and C1 controls -> space, then collapse.
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
