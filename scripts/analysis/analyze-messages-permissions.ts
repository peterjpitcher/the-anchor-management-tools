#!/usr/bin/env tsx
/**
 * Messages module RBAC diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 * - Avoids `process.exit` so errors/logs flush and the script is testable.
 *
 * Notes:
 * - Supports both legacy `permissions/role_permissions` and `rbac_*` table layouts.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'analyze-messages-permissions'

type PermissionRow = {
  id?: unknown
  module_name?: unknown
  action?: unknown
  description?: unknown
}

type RolePermissionRow = {
  role_id?: unknown
  permission_id?: unknown
  roles?: { name?: unknown; description?: unknown } | null
  permissions?: { module_name?: unknown; action?: unknown } | null
  rbac_roles?: { name?: unknown; description?: unknown } | null
  rbac_permissions?: { module_name?: unknown; action?: unknown } | null
}

function loadEnv(): void {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env') })
  }
}

function assertReadOnly(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

async function tryLoadPermissions(params: { supabase: any; table: string }): Promise<PermissionRow[]> {
  const { data, error } = await params.supabase
    .from(params.table)
    .select('id, module_name, action, description')
    .eq('module_name', 'messages')
    .order('action', { ascending: true })

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load ${params.table} permissions for module_name=messages`,
      error,
      data: (data ?? null) as PermissionRow[] | null,
      allowMissing: true,
    }) ?? []

  return rows
}

function printPermissions(perms: PermissionRow[]): void {
  console.log(`\n[${SCRIPT_NAME}] Message module permissions:`)
  console.log(`[${SCRIPT_NAME}] Count: ${perms.length}`)

  for (const perm of perms) {
    console.log(`- action=${String(perm.action ?? '')} id=${String(perm.id ?? '')}`)
    if (perm.description) {
      console.log(`  description=${String(perm.description ?? '')}`)
    }
  }
}

async function loadRolePermissionsLegacy(supabase: any): Promise<RolePermissionRow[]> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select(
      `
      role_id,
      permission_id,
      permissions!inner(module_name, action),
      roles!inner(name, description)
    `
    )
    .eq('permissions.module_name', 'messages')

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load role_permissions for module_name=messages`,
      error,
      data: (data ?? null) as RolePermissionRow[] | null,
      allowMissing: true,
    }) ?? []

  return rows
}

async function loadRolePermissionsRbac(supabase: any): Promise<RolePermissionRow[]> {
  const { data, error } = await supabase
    .from('rbac_role_permissions')
    .select(
      `
      role_id,
      permission_id,
      rbac_permissions!inner(module_name, action),
      rbac_roles!inner(name, description)
    `
    )
    .eq('rbac_permissions.module_name', 'messages')

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load rbac_role_permissions for module_name=messages`,
      error,
      data: (data ?? null) as RolePermissionRow[] | null,
      allowMissing: true,
    }) ?? []

  return rows
}

function printRolePermissions(params: {
  title: string
  rows: RolePermissionRow[]
  getRoleName: (row: RolePermissionRow) => string
  getAction: (row: RolePermissionRow) => string
}): void {
  console.log(`\n[${SCRIPT_NAME}] ${params.title}`)

  const roleMap = new Map<string, string[]>()
  for (const row of params.rows) {
    const roleName = params.getRoleName(row)
    const action = params.getAction(row)
    if (!roleMap.has(roleName)) {
      roleMap.set(roleName, [])
    }
    roleMap.get(roleName)?.push(action)
  }

  if (roleMap.size === 0) {
    console.log(`[${SCRIPT_NAME}] No roles found with messages permissions.`)
    return
  }

  for (const [role, actions] of roleMap.entries()) {
    const unique = Array.from(new Set(actions)).sort((a, b) => a.localeCompare(b))
    console.log(`\n${role}:`)
    for (const action of unique) {
      console.log(`- ${action}`)
    }
  }
}

async function main() {
  loadEnv()
  assertReadOnly()

  const supabase = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)

  let permissionsTable: 'permissions' | 'rbac_permissions' = 'permissions'
  let permissions: PermissionRow[] = []

  try {
    permissions = await tryLoadPermissions({ supabase, table: 'permissions' })
  } catch (error) {
    console.log(`[${SCRIPT_NAME}] Failed to query permissions table; trying rbac_permissions fallback...`)
    permissionsTable = 'rbac_permissions'
    permissions = await tryLoadPermissions({ supabase, table: 'rbac_permissions' })
  }

  console.log(`[${SCRIPT_NAME}] Using permissions table: ${permissionsTable}`)
  printPermissions(permissions)

  if (permissionsTable === 'rbac_permissions') {
    const rolePerms = await loadRolePermissionsRbac(supabase)
    printRolePermissions({
      title: 'Roles with messages permissions (rbac_role_permissions)',
      rows: rolePerms,
      getRoleName: (row) => String(row.rbac_roles?.name ?? row.role_id ?? '(unknown role)'),
      getAction: (row) => String(row.rbac_permissions?.action ?? '(unknown action)'),
    })
    return
  }

  const rolePerms = await loadRolePermissionsLegacy(supabase)
  printRolePermissions({
    title: 'Roles with messages permissions (role_permissions)',
    rows: rolePerms,
    getRoleName: (row) => String(row.roles?.name ?? row.role_id ?? '(unknown role)'),
    getAction: (row) => String(row.permissions?.action ?? '(unknown action)'),
  })
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

