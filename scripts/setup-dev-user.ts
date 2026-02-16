#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'setup-dev-user'
const RUN_MUTATION_ENV = 'RUN_SETUP_DEV_USER_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT'
const HARD_CAP = 1

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
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
  confirm: boolean
  dryRun: boolean
  limit: number | null
  email: string | null
  password: string | null
  role: string | null
  resetPassword: boolean
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }
  return parsed
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const email = findFlagValue(rest, '--email')
  const password = findFlagValue(rest, '--password')
  const role = findFlagValue(rest, '--role')
  const resetPassword = rest.includes('--reset-password')

  return {
    confirm,
    dryRun,
    limit,
    email: typeof email === 'string' && email.trim().length > 0 ? email.trim() : null,
    password: typeof password === 'string' && password.length > 0 ? password : null,
    role: typeof role === 'string' && role.trim().length > 0 ? role.trim() : null,
    resetPassword,
  }
}

async function resolveUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) {
    throw new Error(`Failed to list users: ${error.message || 'unknown error'}`)
  }

  const match = Array.isArray(data?.users) ? data.users.find((user) => user.email === email) : null
  return match?.id ?? null
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    console.log(`[${SCRIPT_NAME}] Example:`)
    console.log(
      `[${SCRIPT_NAME}] ${RUN_MUTATION_ENV}=true ${ALLOW_MUTATION_ENV}=true tsx scripts/setup-dev-user.ts --confirm --limit=1 --email <email> --password <pw> --role <role>`
    )
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }
  if (!args.email) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --email`)
  }
  if (!args.role) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --role`)
  }
  if (!args.password) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --password`)
  }
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  if (args.limit === null) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit=1 (hard cap ${HARD_CAP})`)
  }
  if (args.limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (args.limit < HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit must be ${HARD_CAP}`)
  }

  console.log(`[${SCRIPT_NAME}] Ensuring user exists for ${args.email}...`)
  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
    user_metadata: {
      first_name: 'Dev',
      last_name: 'Verifier',
    },
  })

  let userId = createdUser?.user?.id ?? null

  if (!userId) {
    const createMessage = createError?.message || ''
    if (!createMessage.toLowerCase().includes('already registered')) {
      throw new Error(`Failed to create user: ${createMessage || 'unknown error'}`)
    }

    userId = await resolveUserIdByEmail(admin, args.email)
    if (!userId) {
      throw new Error('User already registered but could not resolve existing user id')
    }

    if (args.resetPassword) {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: args.password,
      })
      if (updateError) {
        throw new Error(`Failed to reset password: ${updateError.message || 'unknown error'}`)
      }
      console.log(`[${SCRIPT_NAME}] Password updated for ${args.email}`)
    } else {
      console.log(`[${SCRIPT_NAME}] User already exists (pass --reset-password to update password)`)
    }
  }

  console.log(`[${SCRIPT_NAME}] Looking up role ${args.role}...`)
  const { data: roleRow, error: roleLookupError } = await (admin.from('roles') as any)
    .select('id')
    .eq('name', args.role)
    .maybeSingle()

  const roleData = assertScriptQuerySucceeded({
    operation: `Load roles(${args.role})`,
    error: roleLookupError,
    data: roleRow as { id: string } | null,
  })

  if (!roleData?.id) {
    throw new Error(`Role not found: ${args.role}`)
  }

  const { data: upsertRows, error: upsertError } = await (admin.from('user_roles') as any)
    .upsert({ user_id: userId, role_id: roleData.id }, { onConflict: 'user_id,role_id' })
    .select('user_id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Upsert user_roles(${userId}, ${roleData.id})`,
    error: upsertError,
    updatedRows: upsertRows as Array<{ user_id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: `Upsert user_roles(${userId}, ${roleData.id})`,
    expected: 1,
    actual: updatedCount,
  })

  console.log(`[${SCRIPT_NAME}] MUTATION complete. user_id=${userId} role=${args.role}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
