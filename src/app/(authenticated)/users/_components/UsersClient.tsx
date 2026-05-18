'use client'

import { useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { Role } from '@/types/rbac'

import { PageHeader, SectionNav } from '@/ds'
import { UsersContent } from './UsersContent'
import { RolesContent } from './RolesContent'

type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>

interface UsersClientProps {
  users: UserSummary[]
  roles: Role[]
  canManageRoles: boolean
}

const SECTION_ITEMS = [
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
]

export function UsersClient({ users, roles, canManageRoles }: UsersClientProps) {
  const [activeSection, setActiveSection] = useState('users')

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Users' }]}
        title="User Management"
        subtitle="Manage users, roles, and permissions"
      />

      <SectionNav
        items={SECTION_ITEMS}
        activeId={activeSection}
        onSelect={setActiveSection}
        className="mb-6"
      />

      {activeSection === 'users' && (
        <UsersContent users={users} roles={roles} canManageRoles={canManageRoles} />
      )}
      {activeSection === 'roles' && <RolesContent />}
    </div>
  )
}
