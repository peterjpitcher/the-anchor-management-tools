import { describe, expect, it } from 'vitest'
import { filterNavGroupsForPermissions, NAV_GROUPS } from '@/ds/shell/SidebarNav'
import type { ActionType, ModuleName } from '@/types/rbac'

describe('navigation gating', () => {
  it('hides sections the user cannot view', () => {
    const allowed = new Set(['dashboard:view', 'messages:view', 'profile:view'])
    const navGroups = filterNavGroupsForPermissions(
      NAV_GROUPS,
      (module: ModuleName, action: ActionType) => allowed.has(`${module}:${action}`),
    )

    const labels = navGroups.flatMap((group) => group.items.map((item) => item.label))

    expect(labels).toContain('Dashboard')
    expect(labels).toContain('Messages')
    expect(labels).toContain('My Profile')
    expect(labels).not.toContain('Employees')
    expect(labels).not.toContain('Settings')
    expect(labels).not.toContain('Users')
  })
})
