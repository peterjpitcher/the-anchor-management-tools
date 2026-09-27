'use client'

import type { Role, UserSummaryWithRoles } from '@/types/rbac'

import { PageLayout } from '@/ds'
import { UsersContent } from './UsersContent'
import { USERS_LAYOUT } from '../_shared/layout'

interface UsersClientProps {
  users: UserSummaryWithRoles[]
  roles: Role[]
  canManageRoles: boolean
}

// Roles are edited on /roles only (owner decision, 26 September 2026), so this page shows users.
export function UsersClient({ users, roles, canManageRoles }: UsersClientProps): React.JSX.Element {
  return (
    <PageLayout {...USERS_LAYOUT}>
      <UsersContent users={users} roles={roles} canManageRoles={canManageRoles} />
    </PageLayout>
  )
}
