import { describe, it, expect } from 'vitest';
import { fullNameKey, idsMatchingFullName } from './names';

// All names fictional.
describe('fullNameKey', () => {
  it('ignores case, surrounding space and repeated inner space', () => {
    expect(fullNameKey('  Miriam   COHEN ')).toBe('miriam cohen');
  });

  it('is empty for a blank name', () => {
    expect(fullNameKey('   ')).toBe('');
  });
});

describe('idsMatchingFullName', () => {
  const people = [
    { id: 1, name: 'Miriam', last_name: 'Cohen' },
    { id: 2, name: 'Miriam', last_name: 'Adler' },
    { id: 3, name: 'Dovid Levi', last_name: null }, // legacy row: whole name in `name`
    { id: 4, name: 'Chaya Sara', last_name: 'Mizrahi' },
    { id: 5, name: 'Shira', last_name: null },
  ];

  it('matches given name + surname, not the given name alone', () => {
    expect(idsMatchingFullName(people, 'Miriam Cohen')).toEqual([1]);
    expect(idsMatchingFullName(people, 'miriam  adler')).toEqual([2]);
  });

  it('does not attach a bare given name to someone who has a surname', () => {
    expect(idsMatchingFullName(people, 'Miriam')).toEqual([]);
  });

  it('finds a legacy row whose full name sits in the given-name column', () => {
    expect(idsMatchingFullName(people, 'Dovid Levi')).toEqual([3]);
  });

  it('handles a multi-word given name', () => {
    expect(idsMatchingFullName(people, 'Chaya Sara Mizrahi')).toEqual([4]);
  });

  it('matches a single-word person by their single word', () => {
    expect(idsMatchingFullName(people, 'Shira')).toEqual([5]);
  });

  it('matches the name as displayed, so a stored "~married" suffix does not hide the person', () => {
    expect(idsMatchingFullName([{ id: 9, name: 'Dina~Levi', last_name: 'Cohen' }], 'Dina Cohen')).toEqual([9]);
  });

  it('returns EVERY person with the name — never quietly the first', () => {
    const twins = [
      { id: 10, name: 'Rivka', last_name: 'Adler' },
      { id: 11, name: 'Rivka', last_name: 'Adler' },
    ];
    expect(idsMatchingFullName(twins, 'Rivka Adler')).toEqual([10, 11]);
  });

  it('counts a person once when their stored and respelled rows both match', () => {
    const stored = { id: 12, name: 'Leah', last_name: 'Cohen' };
    const respelled = { id: 12, name: 'Leah', last_name: 'Cohen' };
    expect(idsMatchingFullName([stored, respelled], 'Leah Cohen')).toEqual([12]);
  });

  it('matches nobody for a blank name', () => {
    expect(idsMatchingFullName(people, '  ')).toEqual([]);
  });
});
