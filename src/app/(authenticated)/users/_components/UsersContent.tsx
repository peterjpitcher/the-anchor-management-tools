'use client'

import { useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { Role } from '@/types/rbac'
import { format } from 'date-fns'

import {
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/ds'
import {
  Avatar,
  Badge,
  Button,
  SearchInput,
  Select,
  Empty,
  Dropdown,
  DropdownItem,
} from '@/ds'
import { Icon } from '@/ds/icons'
import UserRolesModal from '../components/UserRolesModal'

type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>

interface UsersContentProps {
  users: UserSummary[]
  roles: Role[]
  canManageRoles: boolean
}

const ROLE_OPTIONS = [
  { value: 'all', label: 'All roles' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
]

export function UsersContent({ users, roles, canManageRoles }: UsersContentProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null)
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false)

  const filteredUsers = users.filter((user) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const emailMatch = (user.email || '').toLowerCase().includes(q)
      const idMatch = user.id.toLowerCase().includes(q)
      if (!emailMatch && !idMatch) return false
    }
    return true
  })

  const handleManageRoles = (user: UserSummary) => {
    setSelectedUser(user)
    setIsRolesModalOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search users..."
          className="w-64"
        />
        <Select
          options={ROLE_OPTIONS}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Table */}
      {filteredUsers.length === 0 ? (
        <Card>
          <Empty
            title="No users found"
            description={searchQuery ? 'Try adjusting your search query.' : 'Start by inviting users to your application.'}
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Sign In</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={user.email || 'User'} size="sm" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-text-strong truncate">
                          {user.email}
                        </p>
                        <p className="text-[11px] text-text-muted truncate">
                          {user.id}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone="neutral">User</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-[13px] text-text-muted">
                      {format(new Date(user.created_at), 'MMM d, yyyy')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[13px] text-text-muted">
                      {user.last_sign_in_at
                        ? format(new Date(user.last_sign_in_at), 'MMM d, yyyy h:mm a')
                        : 'Never'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {canManageRoles && (
                      <Dropdown
                        trigger={
                          <Button variant="ghost" size="sm">
                            <Icon name="moreHorizontal" size={16} />
                          </Button>
                        }
                      >
                        <DropdownItem onClick={() => handleManageRoles(user)}>
                          Manage Roles
                        </DropdownItem>
                      </Dropdown>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Roles modal (domain component, preserved) */}
      {canManageRoles && selectedUser && (
        <UserRolesModal
          isOpen={isRolesModalOpen}
          onClose={() => {
            setIsRolesModalOpen(false)
            setSelectedUser(null)
          }}
          user={selectedUser}
          allRoles={roles}
          canManageRoles={canManageRoles}
        />
      )}
    </div>
  )
}
