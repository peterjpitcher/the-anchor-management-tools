#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

const SCRIPT_NAME = 'check-user-permissions'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

type Args = {
  userId: string | null
  email: string | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const userId = findFlagValue(rest, '--user-id')
  const email = findFlagValue(rest, '--email')

  return {
    userId: typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : null,
    email: typeof email === 'string' && email.trim().length > 0 ? email.trim() : null,
  }
}

async function resolveUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) {
    throw new Error(`Supabase auth.admin.listUsers failed: ${error.message || 'unknown error'}`)
  }

  const match = Array.isArray(data?.users) ? data.users.find((user) => user.email === email) : null
  return match?.id ?? null
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (!args.userId && !args.email) {
    markFailure('Usage: tsx scripts/database/check-user-permissions.ts --user-id <uuid> OR --email <email>')
    return
  }

  const admin = createAdminClient()

  let userId = args.userId
  if (!userId && args.email) {
    userId = await resolveUserIdByEmail(admin, args.email)
    if (!userId) {
      markFailure(`No auth user found for email: ${args.email}`)
      return
    }
  }

  if (!userId) {
    markFailure('Could not resolve user id')
    return
  }

  console.log('=== CHECKING USER PERMISSIONS ===\n')
  console.log(`User ID: ${userId}`)
  if (args.email) {
    console.log(`Email: ${args.email}\n`)
  }

  // Get user's role assignments
  const { data: roleAssignments, error: roleAssignmentsError } = await (admin.from('user_role_assignments') as any)
    .select(
      `
      role:rbac_roles(
        name,
        role_permissions:rbac_role_permissions(
          permission:rbac_permissions(
            module,
            action
          )
        )
      )
    `
    )
    .eq('user_id', userId)

  if (roleAssignmentsError) {
    markFailure('Failed to load role assignments for user.', roleAssignmentsError)
    return
  }

  if (!roleAssignments || roleAssignments.length === 0) {
    markFailure('No role assignments found for user.')
    return
  }

  console.log('Roles and Permissions:')
  roleAssignments.forEach((assignment: any) => {
    console.log(`\nRole: ${assignment.role?.name}`)

    const permissions = assignment.role?.role_permissions || []
    const messagePermissions = permissions.filter((p: any) => p.permission?.module === 'messages')

    if (messagePermissions.length > 0) {
      console.log('  Messages module permissions:')
      messagePermissions.forEach((p: any) => {
        console.log(`    - ${p.permission?.action}`)
      })
    } else {
      console.log('  ❌ No messages module permissions')
    }
  })

  // Check specific permission
  console.log('\n=== CHECKING SPECIFIC PERMISSIONS ===')

  const { data: hasManagePermission, error: manageError } = await admin.rpc('user_has_permission', {
    p_user_id: userId,
    p_module: 'messages',
    p_action: 'manage',
  })

  if (manageError) {
    markFailure('user_has_permission RPC failed (messages.manage).', manageError)
  }

  console.log(`\nmessages.manage permission: ${hasManagePermission ? '✅ YES' : '❌ NO'}`)

  const { data: hasViewPermission, error: viewError } = await admin.rpc('user_has_permission', {
    p_user_id: userId,
    p_module: 'sms_health',
    p_action: 'view',
  })

  if (viewError) {
    markFailure('user_has_permission RPC failed (sms_health.view).', viewError)
  }

  console.log(`sms_health.view permission: ${hasViewPermission ? '✅ YES' : '❌ NO'}`)

  if (!hasManagePermission) {
    console.log('\n⚠️  You need the "messages.manage" permission to see the Twilio Messages Monitor page')
    markFailure('Missing required permission: messages.manage.')
  }

  if (!hasViewPermission) {
    markFailure('Missing required permission: sms_health.view.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ User permissions check completed with failures.')
  } else {
    console.log('\n✅ User permissions check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-user-permissions failed.', error)
})
