#!/usr/bin/env tsx
/**
 * API key access diagnostics (read-only).
 *
 * Safety:
 * - Blocks --confirm (no mutations).
 * - Requires explicit --key-hash (or API_KEY_HASH) target.
 * - Fails closed via process.exitCode on env/query validation failures.
 */

import dotenv from 'dotenv'
import path from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  const value = process.argv[index + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function requireKeyHash(rawValue: string | null): string {
  if (!rawValue) {
    throw new Error('Missing required --key-hash (or API_KEY_HASH).')
  }

  const normalized = rawValue.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Invalid --key-hash value. Expected a 64-character sha256 hex string.')
  }

  return normalized
}

async function queryAnonVisibleRows(
  supabaseUrl: string,
  anonKey: string,
  keyHash: string
): Promise<{ visibleCount: number | null; errorMessage: string | null }> {
  const requestUrl = new URL('/rest/v1/api_keys', supabaseUrl)
  requestUrl.searchParams.set('select', 'id')
  requestUrl.searchParams.set('key_hash', `eq.${keyHash}`)
  requestUrl.searchParams.set('limit', '1')

  const response = await fetch(requestUrl.toString(), {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      prefer: 'count=exact'
    }
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as { message?: string }
      if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
        message = payload.message.trim()
      }
    } catch {
      // Keep fallback status text when no JSON error payload is returned.
    }
    return { visibleCount: null, errorMessage: message }
  }

  const contentRange = response.headers.get('content-range')
  if (contentRange) {
    const [, total] = contentRange.split('/')
    const parsedTotal = Number.parseInt(total ?? '', 10)
    if (Number.isFinite(parsedTotal) && parsedTotal >= 0) {
      return { visibleCount: parsedTotal, errorMessage: null }
    }
  }

  const rows = await response.json() as unknown[]
  return { visibleCount: rows.length, errorMessage: null }
}

async function run() {
  if (hasFlag('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
  const keyHash = requireKeyHash(getArgValue('--key-hash') ?? process.env.API_KEY_HASH ?? null)

  console.log('API key access diagnostics (read-only)')
  console.log(`Target key hash: ${keyHash}`)
  console.log('')

  const serviceClient = createAdminClient()
  const { data: serviceRowsResult, error: serviceError } = await serviceClient
    .from('api_keys')
    .select('id, name, is_active, permissions, rate_limit')
    .eq('key_hash', keyHash)
    .limit(5)

  const serviceRows = (assertScriptQuerySucceeded({
    operation: 'Load api_keys rows for target hash',
    error: serviceError,
    data: serviceRowsResult ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    name: string | null
    is_active: boolean | null
    permissions: unknown
    rate_limit: number | null
  }>

  if (!serviceRows || serviceRows.length === 0) {
    throw new Error('No api_keys rows matched the provided --key-hash.')
  }

  console.log(`Service role access verified. Matching rows: ${serviceRows.length}`)
  const first = serviceRows[0]
  console.log(`- Name: ${first.name}`)
  console.log(`- Active: ${first.is_active ? 'yes' : 'no'}`)
  console.log(`- Permissions: ${JSON.stringify(first.permissions)}`)
  console.log(`- Rate limit: ${first.rate_limit}`)

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''
  if (!anonKey) {
    console.log('\nAnon key is not configured; skipping anon role visibility check.')
    return
  }

  console.log('\nRunning anon role visibility check...')
  const anonResult = await queryAnonVisibleRows(supabaseUrl, anonKey, keyHash)

  if (anonResult.errorMessage) {
    console.log(`Anon role query failed (likely expected with RLS): ${anonResult.errorMessage}`)
    return
  }

  console.log(`Anon role query succeeded. Visible rows: ${anonResult.visibleCount ?? 0}`)
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
