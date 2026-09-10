import { describe, it, expect } from 'vitest';
import { familyLabel } from '@/lib/family-label';

/**
 * One rule, five surfaces (invite landing, join confirmation, joined banner, family
 * switcher, /families/new). A family that renders under two different names on two of
 * them reads as two different families, which is the whole reason this is a function
 * and not an inline ternary repeated per page.
 */
describe('familyLabel', () => {
  it('prefers the Hebrew name in Hebrew', () => {
    expect(familyLabel('he', 'Example Family', 'משפחת דוגמה')).toBe('משפחת דוגמה');
  });

  it('uses the Latin name in English even when a Hebrew name exists', () => {
    expect(familyLabel('en', 'Example Family', 'משפחת דוגמה')).toBe('Example Family');
  });

  it('falls back to the Latin name in Hebrew when name_he was never entered', () => {
    // name_he is optional everywhere in the schema, so this is the common case for a
    // family created by an English speaker.
    expect(familyLabel('he', 'Example Family', null)).toBe('Example Family');
    expect(familyLabel('he', 'Example Family', undefined)).toBe('Example Family');
  });

  it('treats an empty Hebrew name as absent, not as a blank label', () => {
    // A form that submits '' rather than NULL must not blank out the family's name.
    expect(familyLabel('he', 'Example Family', '')).toBe('Example Family');
  });
});
