// src/lib/foh/__tests__/user-mode.test.ts
// Characterization test: pins isFohOnlyUser behaviour BEFORE Phase 2 widens FOH_MODULES to
// include 'checklists'. The last case asserts today's behaviour (adding a second module
// breaks FOH-only mode); Phase 2 will flip that expectation in the same change that widens
// the predicate. See tasks/checklists-discovery/spec.md v4 section 12.
import { describe, it, expect } from 'vitest'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import type { UserPermission } from '@/types/rbac'

const perm = (module_name: string, action = 'view'): UserPermission =>
  ({ module_name, action } as unknown as UserPermission)

describe('isFohOnlyUser (current behaviour, pre-checklists)', () => {
  it('returns false for an empty permission list', () => {
    expect(isFohOnlyUser([])).toBe(false)
  })
  it('returns false when table_bookings:view is absent', () => {
    expect(isFohOnlyUser([perm('events'), perm('customers')])).toBe(false)
  })
  it('returns true when every permission is on table_bookings and view is present', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('table_bookings', 'edit')])).toBe(true)
  })
  it('returns false when any permission is outside table_bookings', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('checklists', 'view')])).toBe(false)
  })
})
