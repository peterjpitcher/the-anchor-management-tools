#!/usr/bin/env tsx
/**
 * API key database diagnostics (read-only).
 *
 * Safety note:
 * - This script must not mutate the database.
 * - It masks sensitive values and fails closed on query errors.
 */

import { createHash } from 'node:crypto'
import dotenv from 'dotenv'
import path from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-api-key-database'

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  const value = process.argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

function maskApiKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '(missing)'
  const trimmed = value.trim()
  if (trimmed.length <= 10) return '***'
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`
}

function hashApiKey(key: string): string {
  const hash = createHash('sha256')
  hash['update'](key)
  return hash.digest('hex')
}

async function run() {
  if (isFlagPresent('--confirm')) {
    throw new Error('check-api-key-database is read-only and does not support --confirm.')
  }

  console.log('API key database diagnostics (read-only)\n')

  const apiKey =
    getArgValue('--api-key') ?? process.env.TEST_API_KEY_TO_CHECK ?? null
  const shouldList = isFlagPresent('--list')

  console.log('Supabase admin client: using script-safe service-role configuration')
  console.log(`API key: ${maskApiKey(apiKey)}`)
  console.log(`List keys: ${shouldList ? 'yes' : 'no'} (--list)`)
  console.log('')

  const supabase = createAdminClient()

  const { data: allKeysRaw, error: allError } = await supabase
    .from('api_keys')
    .select('id, name, key_hash, is_active, permissions, created_at, last_used_at')

  const allKeys = (assertScriptQuerySucceeded({
    operation: 'Load api_keys inventory',
    error: allError,
    data: allKeysRaw ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    name: string
    key_hash: string
    is_active: boolean
    permissions: unknown
    created_at: string | null
    last_used_at: string | null
  }>

  if (allKeys.length === 0) {
    throw new Error('No API keys found in database.')
  }

  console.log(`Keys found: ${allKeys.length}`)

  if (shouldList) {
    console.log('\nKey inventory (names only):')
    for (const key of allKeys) {
      console.log(`- ${key.name} (${key.is_active ? 'active' : 'inactive'})`)
    }
  }

  if (!apiKey) {
    throw new Error('Missing required --api-key (or TEST_API_KEY_TO_CHECK).')
  }

  const keyHash = hashApiKey(apiKey)
  console.log(`\nKey hash (sha256): ${keyHash}`)

  const matchingKey = allKeys.find((k) => k.key_hash === keyHash)
  if (!matchingKey) {
    console.log('\n❌ Key NOT found in database (no matching hash).')
    console.log('If this is unexpected, generate a new API key or verify you are using the correct value.')
    throw new Error('API key not found')
  }

  console.log('\n✅ Key found in database.')
  console.log(`- Name: ${matchingKey.name}`)
  console.log(`- Active: ${matchingKey.is_active ? 'yes' : 'no'}`)
  console.log(`- Permissions: ${JSON.stringify(matchingKey.permissions)}`)
  console.log(`- Created: ${matchingKey.created_at}`)
  console.log(`- Last used: ${matchingKey.last_used_at || 'Never'}`)

  if (!matchingKey.is_active) {
    console.log('\n⚠️  Key exists but is inactive.')
  }

  console.log('\n✅ Read-only API key diagnostics completed.')
}

void run().catch((error) => {
  markFailure('check-api-key-database failed.', error)
})
