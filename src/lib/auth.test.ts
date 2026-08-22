import { describe, it, expect } from 'vitest';
import { roleAllows } from '@/lib/auth';

// Pure privilege-ladder decision, extracted from the guards so it can be tested
// without a request/cookie/DB. owner ⊃ editor ⊃ viewer.
describe('roleAllows', () => {
  it('owner can view, edit, and delete', () => {
    expect(roleAllows('owner', 'view')).toBe(true);
    expect(roleAllows('owner', 'edit')).toBe(true);
    expect(roleAllows('owner', 'delete')).toBe(true);
  });

  it('editor can view and edit but not delete', () => {
    expect(roleAllows('editor', 'view')).toBe(true);
    expect(roleAllows('editor', 'edit')).toBe(true);
    expect(roleAllows('editor', 'delete')).toBe(false);
  });

  it('viewer can view but not edit or delete', () => {
    expect(roleAllows('viewer', 'view')).toBe(true);
    expect(roleAllows('viewer', 'edit')).toBe(false);
    expect(roleAllows('viewer', 'delete')).toBe(false);
  });
});
