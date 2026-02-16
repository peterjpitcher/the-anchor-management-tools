#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkMessagesPermissions() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-messages-permissions is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('Checking messages module permissions...\n')

  const { data: permissionsRows, error: permissionsError } = await supabase
    .from('rbac_permissions')
    .select('id, module, action')
    .eq('module', 'messages')
    .order('action', { ascending: true })

  const permissions = (assertScriptQuerySucceeded({
    operation: 'Load messages module permissions',
    error: permissionsError,
    data: permissionsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; action: string | null }>

  console.log('Messages module permissions in database:')
  console.log('=========================================')
  permissions.forEach((perm) => {
    console.log(`- ${perm.action || 'unknown'} (ID: ${perm.id})`)
  })

  console.log('\n\nPermissions being checked in code:')
  console.log('===================================')
  console.log('1. Actions/routes commonly check: checkUserPermission("messages", "manage")')
  console.log('2. Job queue send path commonly checks: checkUserPermission("messages", "send")')

  const hasManage = permissions.some((p) => p.action === 'manage')
  const hasSend = permissions.some((p) => p.action === 'send')

  console.log('\n\nAnalysis:')
  console.log('=========')
  console.log(`- 'manage' permission exists: ${hasManage ? 'YES' : 'NO ❌'}`)
  console.log(`- 'send' permission exists: ${hasSend ? 'YES' : 'NO ❌'}`)

  if (!hasManage) {
    markFailure('messages.manage permission is missing (code expects it).')
  }

  if (!hasSend) {
    markFailure('messages.send permission is missing (code expects it).')
  }

  console.log('\n\nRole permissions for messages module:')
  console.log('=====================================')

  const { data: rolePermissionsRows, error: roleError } = await supabase
    .from('rbac_role_permissions')
    .select('role:rbac_roles(name), permission:rbac_permissions(module, action)')
    .eq('rbac_permissions.module', 'messages')

  const rolePermissions = (assertScriptQuerySucceeded({
    operation: 'Load role permissions for messages module',
    error: roleError,
    data: rolePermissionsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    role: { name: string | null } | null
    permission: { action: string | null } | null
  }>

  const roleMap = new Map<string, string[]>()

  for (const row of rolePermissions) {
    const roleName = row.role?.name
    const action = row.permission?.action
    if (!roleName || !action) continue

    const existing = roleMap.get(roleName) ?? []
    existing.push(action)
    roleMap.set(roleName, existing)
  }

  roleMap.forEach((actions, role) => {
    console.log(`\n${role}:`)
    actions.sort().forEach((action) => {
      console.log(`  - ${action}`)
    })
  })
}

void checkMessagesPermissions().catch((error) => {
  markFailure('check-messages-permissions failed.', error)
})
