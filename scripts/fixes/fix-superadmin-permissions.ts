#!/usr/bin/env tsx

/**
 * fix-superadmin-permissions (safe by default)
 *
 * Intended use: ensure the super_admin role has the customers:manage permission.
 * Optionally, grant additional missing permissions to super_admin behind explicit caps.
 *
 * Dry-run (default):
 *   tsx scripts/fixes/fix-superadmin-permissions.ts
 *
 * Mutation mode (requires multi-gating):
 *   RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true \\
 *   ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true \\
 *     tsx scripts/fixes/fix-superadmin-permissions.ts --confirm --ensure-customers-manage
 *
 * Grant all missing permissions (high risk; requires explicit caps):
 *   RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true \\
 *   ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true \\
 *     tsx scripts/fixes/fix-superadmin-permissions.ts --confirm --grant-all-missing --limit 50 [--offset 0]
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import {
  assertFixSuperadminPermissionsLimit,
  assertFixSuperadminPermissionsMutationAllowed,
  isFixSuperadminPermissionsMutationEnabled,
  readFixSuperadminPermissionsLimit,
  readFixSuperadminPermissionsOffset
} from '../../src/lib/fix-superadmin-permissions-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type PermissionRow = {
  id: string
  module_name: string | null
  action: string | null
}

type RoleRow = {
  id: string
  name: string | null
}

type RolePermissionRow = {
  permission_id: string
}

function isFlagPresent(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag)
}

function formatPermissionLabel(permission: PermissionRow): string {
  return `${permission.module_name ?? 'unknown'}:${permission.action ?? 'unknown'}`
}

async function run(): Promise<void> {
  const argv = process.argv
  const confirm = isFlagPresent('--confirm', argv)
  const mutationEnabled = isFixSuperadminPermissionsMutationEnabled(argv, process.env)
  const ensureCustomersManage = isFlagPresent('--ensure-customers-manage', argv)
  const grantAllMissing = isFlagPresent('--grant-all-missing', argv)

  const HARD_CAP = 200

  if (isFlagPresent('--help', argv)) {
    console.log(`
fix-superadmin-permissions (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-superadmin-permissions.ts

Mutation mode (requires multi-gating):
  RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true \\
  ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true \\
    tsx scripts/fixes/fix-superadmin-permissions.ts --confirm --ensure-customers-manage

Grant all missing permissions (high risk; requires explicit caps):
  RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true \\
  ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true \\
    tsx scripts/fixes/fix-superadmin-permissions.ts --confirm --grant-all-missing --limit 50 [--offset 0]

Notes:
  - --limit is required for --grant-all-missing (hard cap ${HARD_CAP}).
  - In dry-run mode, no rows are updated.
`)
    return
  }

  if (confirm && !mutationEnabled && !isFlagPresent('--dry-run', argv)) {
    throw new Error(
      'fix-superadmin-permissions received --confirm but RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION is not enabled. Set RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true and ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true to apply updates.'
    )
  }

  if (mutationEnabled) {
    if (!ensureCustomersManage && !grantAllMissing) {
      throw new Error(
        'fix-superadmin-permissions blocked: mutation mode requires an explicit operation flag (--ensure-customers-manage and/or --grant-all-missing).'
      )
    }

    assertFixSuperadminPermissionsMutationAllowed(process.env)
  }

  const supabase = createAdminClient()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'

  console.log(`🔧 fix-superadmin-permissions (${modeLabel})\n`)

  const { data: roleRowRaw, error: roleError } = await supabase
    .from('roles')
    .select('id, name')
    .eq('name', 'super_admin')
    .maybeSingle()

  const roleRow = assertScriptQuerySucceeded({
    operation: 'Load super_admin role',
    error: roleError,
    data: roleRowRaw as RoleRow | null,
  }) as RoleRow | null

  if (!roleRow?.id) {
    throw new Error('super_admin role not found')
  }

  console.log(`Role: super_admin (${roleRow.id})`)

  const { data: customersManagePermRaw, error: customersManagePermError } = await supabase
    .from('permissions')
    .select('id, module_name, action')
    .eq('module_name', 'customers')
    .eq('action', 'manage')
    .maybeSingle()

  const customersManagePerm = assertScriptQuerySucceeded({
    operation: 'Load customers:manage permission',
    error: customersManagePermError,
    data: customersManagePermRaw as PermissionRow | null,
    allowMissing: true
  }) as PermissionRow | null

  const { data: allPermissionsRaw, error: permissionsError } = await supabase
    .from('permissions')
    .select('id, module_name, action')

  const allPermissions = assertScriptQuerySucceeded({
    operation: 'Load all permissions',
    error: permissionsError,
    data: allPermissionsRaw ?? [],
    allowMissing: true
  }) as PermissionRow[]

  const { data: existingRolePermsRaw, error: existingRolePermsError } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .eq('role_id', roleRow.id)

  const existingRolePerms = assertScriptQuerySucceeded({
    operation: 'Load existing role_permissions for super_admin',
    error: existingRolePermsError,
    data: existingRolePermsRaw ?? [],
    allowMissing: true
  }) as RolePermissionRow[]

  const existingPermIds = new Set(
    existingRolePerms
      .map((row) => row.permission_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )

  const missingPermissions = allPermissions.filter((perm) => !existingPermIds.has(perm.id))
  const customersManageAssigned = customersManagePerm ? existingPermIds.has(customersManagePerm.id) : false

  console.log(`Permissions total: ${allPermissions.length}`)
  console.log(`Assigned to super_admin: ${existingPermIds.size}`)
  console.log(`Missing from super_admin: ${missingPermissions.length}`)
  console.log(
    `customers:manage permission: ${customersManagePerm ? `present (${customersManagePerm.id})` : 'missing'}`
  )
  console.log(`customers:manage assigned: ${customersManageAssigned}`)

  if (!mutationEnabled) {
    if (missingPermissions.length > 0) {
      const preview = missingPermissions
        .slice(0, 10)
        .map(formatPermissionLabel)
        .join(', ')
      console.log(`\nSample missing permissions (first 10): ${preview}`)
    }

    console.log('\nDry-run mode: no changes applied.')
    console.log('To mutate, pass --confirm and set env gates:')
    console.log('  RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true')
    console.log('  ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true')
    console.log('Then select an operation:')
    console.log('  --ensure-customers-manage')
    console.log('  --grant-all-missing --limit <n> [--offset <n>]')
    return
  }

  const failures: string[] = []

  if (ensureCustomersManage) {
    let permissionId = customersManagePerm?.id ?? null
    if (!permissionId) {
      console.log('\nCreating customers:manage permission...')
      const { data: insertedPermRows, error: insertPermError } = await supabase
        .from('permissions')
        .insert({
          module_name: 'customers',
          action: 'manage',
          description: 'Manage customer labels and settings'
        })
        .select('id')

      try {
        const { updatedCount } = assertScriptMutationSucceeded({
          operation: 'Insert customers:manage permission',
          error: insertPermError,
          updatedRows: insertedPermRows as Array<{ id?: string }> | null,
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Insert customers:manage permission',
          expected: 1,
          actual: updatedCount
        })
        permissionId = insertedPermRows?.[0]?.id ?? null
        if (!permissionId) {
          throw new Error('Insert customers:manage permission returned no id')
        }
        console.log(`✅ Created customers:manage permission (${permissionId})`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(message)
        console.error(`❌ Failed creating customers:manage permission: ${message}`)
      }
    }

    if (permissionId && !existingPermIds.has(permissionId)) {
      console.log('\nGranting customers:manage to super_admin...')
      const { data: insertedRolePermRows, error: insertRolePermError } = await supabase
        .from('role_permissions')
        .insert({
          role_id: roleRow.id,
          permission_id: permissionId
        })
        .select('permission_id')

      try {
        const { updatedCount } = assertScriptMutationSucceeded({
          operation: 'Insert role_permissions row for customers:manage',
          error: insertRolePermError,
          updatedRows: insertedRolePermRows as Array<{ id?: string }> | null,
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Insert role_permissions row for customers:manage',
          expected: 1,
          actual: updatedCount
        })
        console.log('✅ Granted customers:manage to super_admin')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(message)
        console.error(`❌ Failed granting customers:manage: ${message}`)
      }
    } else if (permissionId) {
      console.log('\nℹ️ customers:manage is already granted to super_admin; skipping.')
    }
  }

  if (grantAllMissing) {
    const limit = assertFixSuperadminPermissionsLimit(
      readFixSuperadminPermissionsLimit(argv, process.env),
      HARD_CAP
    )
    const offset = readFixSuperadminPermissionsOffset(argv, process.env) ?? 0

    const sortedMissing = [...missingPermissions].sort((a, b) =>
      formatPermissionLabel(a).localeCompare(formatPermissionLabel(b))
    )
    const slice = sortedMissing.slice(offset, offset + limit)

    console.log(`\nGranting missing permissions: offset=${offset} limit=${limit}`)
    console.log(`Selected: ${slice.length}/${sortedMissing.length} missing permission(s)`)

    if (slice.length === 0) {
      console.log('No missing permissions selected for granting.')
    } else {
      const insertRows = slice.map((perm) => ({
        role_id: roleRow.id,
        permission_id: perm.id
      }))

      const { data: insertedRows, error: insertError } = await supabase
        .from('role_permissions')
        .insert(insertRows)
        .select('permission_id')

      try {
        const { updatedCount } = assertScriptMutationSucceeded({
          operation: 'Insert missing role_permissions rows for super_admin',
          error: insertError,
          updatedRows: insertedRows as Array<{ id?: string }> | null,
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Insert missing role_permissions rows for super_admin',
          expected: slice.length,
          actual: updatedCount
        })
        console.log(`✅ Granted ${updatedCount} permission(s) to super_admin`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(message)
        console.error(`❌ Grant-all-missing failed: ${message}`)
      }
    }
  }

  assertScriptCompletedWithoutFailures({
    scriptName: 'fix-superadmin-permissions',
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ fix-superadmin-permissions completed without unresolved failures.')
}

run().catch((error) => {
  console.error('fix-superadmin-permissions failed:', error)
  process.exitCode = 1
})

