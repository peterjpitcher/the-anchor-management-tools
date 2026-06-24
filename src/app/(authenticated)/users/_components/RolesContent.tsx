'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Role, Permission } from '@/types/rbac'
import {
  getAllRoles,
  getAllPermissions,
  getRolePermissions,
  assignPermissionsToRole,
} from '@/app/actions/rbac'

import {
  Card,
  CardHeader,
  CardBody,
} from '@/ds'
import {
  Badge,
  Button,
  Checkbox,
  Spinner,
  Empty,
} from '@/ds'
import { toast } from '@/ds'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODULE_DISPLAY: Record<string, string> = {
  dashboard: 'Dashboard',
  events: 'Events',
  performers: 'Performers',
  customers: 'Customers',
  employees: 'Employees',
  messages: 'Messages',
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles',
  private_bookings: 'Private Bookings',
  table_bookings: 'Table Bookings',
  invoices: 'Invoices',
  quotes: 'Quotes',
  receipts: 'Receipts',
  parking: 'Parking',
  menu_management: 'Menu Management',
  rota: 'Rota',
  leave: 'Leave',
  timeclock: 'Timeclock',
  payroll: 'Payroll',
  mileage: 'Mileage',
  expenses: 'Expenses',
  mgd: 'MGD',
  short_links: 'Short Links',
  cashing_up: 'Cashing Up',
  oj_projects: 'OJ Projects',
  loyalty: 'Loyalty',
  reports: 'Reports',
  sms_health: 'SMS Health',
}

const ACTION_COLUMNS = ['view', 'create', 'edit', 'delete', 'manage']

/* ------------------------------------------------------------------ */
/*  RolesContent                                                       */
/* ------------------------------------------------------------------ */

export function RolesContent() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [rolePermissionIds, setRolePermissionIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Build permission lookup: module -> action -> permissionId
  const permissionLookup = new Map<string, string>()
  for (const p of permissions) {
    permissionLookup.set(`${p.module_name}:${p.action}`, p.id)
  }

  // Unique modules
  const modules = [...new Set(permissions.map((p) => p.module_name))].sort()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rolesResult, permsResult] = await Promise.all([
        getAllRoles(),
        getAllPermissions(),
      ])

      if ('error' in rolesResult) {
        toast.error(rolesResult.error ?? 'Failed to load roles')
        return
      }
      if ('error' in permsResult) {
        toast.error(permsResult.error ?? 'Failed to load permissions')
        return
      }

      const loadedRoles = rolesResult.data || []
      const loadedPerms = permsResult.data || []
      setRoles(loadedRoles)
      setPermissions(loadedPerms)

      // Auto-select first role
      if (loadedRoles.length > 0 && !selectedRoleId) {
        setSelectedRoleId(loadedRoles[0].id)
      }
    } catch {
      toast.error('Failed to load roles data')
    } finally {
      setLoading(false)
    }
  }, [selectedRoleId])

  const loadRolePermissions = useCallback(async (roleId: string) => {
    try {
      const result = await getRolePermissions(roleId)
      if ('error' in result) {
        toast.error(result.error ?? 'Failed to load role permissions')
        return
      }
      const ids = new Set((result.data || []).map((rp: { permission_id: string }) => rp.permission_id))
      setRolePermissionIds(ids)
    } catch {
      toast.error('Failed to load role permissions')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (selectedRoleId) {
      void loadRolePermissions(selectedRoleId)
    }
  }, [selectedRoleId, loadRolePermissions])

  const togglePermission = (module: string, action: string) => {
    const key = `${module}:${action}`
    const permId = permissionLookup.get(key)
    if (!permId) return

    setRolePermissionIds((prev) => {
      const next = new Set(prev)
      if (next.has(permId)) {
        next.delete(permId)
      } else {
        next.add(permId)
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!selectedRoleId) return
    setSaving(true)
    try {
      const result = await assignPermissionsToRole(selectedRoleId, Array.from(rolePermissionIds))
      if ('error' in result) {
        toast.error(result.error ?? 'Failed to save permissions')
      } else {
        toast.success('Permissions updated')
      }
    } catch {
      toast.error('Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (roles.length === 0) {
    return (
      <Card>
        <Empty
          title="No roles defined"
          description="Create roles to manage user permissions."
        />
      </Card>
    )
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId)

  return (
    <div className="grid grid-cols-[260px_1fr] gap-6">
      {/* Left: Role list sidebar */}
      <Card>
        <CardHeader title="Roles" />
        <div className="divide-y divide-border">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                role.id === selectedRoleId ? 'bg-primary-soft' : 'hover:bg-surface-hover'
              }`}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-strong truncate">{role.name}</p>
                {role.description && (
                  <p className="text-[11px] text-text-muted truncate mt-0.5">{role.description}</p>
                )}
              </div>
              {role.is_system && (
                <Badge tone="neutral" className="ml-2 flex-shrink-0">System</Badge>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Right: Permission matrix */}
      <Card>
        <CardHeader
          title={selectedRole ? `${selectedRole.name} Permissions` : 'Permissions'}
          subtitle={selectedRole?.description || undefined}
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              loading={saving}
            >
              Save Changes
            </Button>
          }
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="text-left py-2 pr-4 font-medium text-text-muted uppercase text-[11px] tracking-wider">
                  Module
                </th>
                {ACTION_COLUMNS.map((action) => (
                  <th
                    key={action}
                    scope="col"
                    className="text-center py-2 px-2 font-medium text-text-muted uppercase text-[11px] tracking-wider w-20"
                  >
                    {action}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {modules.map((module) => (
                <tr key={module} className="hover:bg-surface-hover transition-colors">
                  <td className="py-2.5 pr-4 text-text-strong font-medium">
                    {MODULE_DISPLAY[module] || module}
                  </td>
                  {ACTION_COLUMNS.map((action) => {
                    const key = `${module}:${action}`
                    const permId = permissionLookup.get(key)
                    const exists = !!permId
                    const checked = permId ? rolePermissionIds.has(permId) : false

                    return (
                      <td key={action} className="text-center py-2.5 px-2">
                        {exists ? (
                          <div className="flex justify-center">
                            <Checkbox
                              aria-label={`${MODULE_DISPLAY[module] || module} ${action} permission`}
                              checked={checked}
                              onChange={() => togglePermission(module, action)}
                            />
                          </div>
                        ) : (
                          <span className="text-text-subtle">-</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  )
}
