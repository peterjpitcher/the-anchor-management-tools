// src/lib/foh/__tests__/user-mode.test.ts
// Phase 2 widened FOH_MODULES to { table_bookings, checklists } so the FOH iPad can reach
// /checklists without losing chromeless kiosk mode. See spec v4 section 12.
import { describe, it, expect } from 'vitest'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import type { UserPermission } from '@/types/rbac'

const perm = (module_name: string, action = 'view'): UserPermission =>
  ({ module_name, action } as unknown as UserPermission)

describe('isFohOnlyUser', () => {
  it('returns false for an empty permission list', () => {
    expect(isFohOnlyUser([])).toBe(false)
  })
  it('returns false when table_bookings:view is absent', () => {
    expect(isFohOnlyUser([perm('events'), perm('customers')])).toBe(false)
  })
  it('returns true when every permission is on table_bookings and view is present', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('table_bookings', 'edit')])).toBe(true)
  })
  it('returns true when permissions are table_bookings + checklists (FOH iPad, Phase 2)', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('checklists', 'view')])).toBe(true)
  })
  it('returns false when any permission is outside the FOH module allowlist', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('events', 'view')])).toBe(false)
  })
  it('still requires table_bookings:view even if checklists is present', () => {
    expect(isFohOnlyUser([perm('checklists', 'view')])).toBe(false)
  })
})
