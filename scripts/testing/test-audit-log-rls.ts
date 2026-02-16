#!/usr/bin/env tsx
/**
 * Audit log RLS diagnostics (read-only).
 *
 * Safety note:
 * - This script must not insert rows or create helper functions in production.
 * - It is strictly read-only and fails closed on any query/RPC error.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP_LIMIT = 50

function getArgValue(flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 2; i < process.argv.length; i += 1) {
    const entry = process.argv[i]
    if (entry === flag) {
      const next = process.argv[i + 1]
      return typeof next === 'string' && next.length > 0 ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      const value = entry.slice(withEqualsPrefix.length)
      return value.length > 0 ? value : null
    }
  }
  return null
}

function parseLimit(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer for --limit: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for --limit: ${value}`)
  }
  if (parsed > HARD_CAP_LIMIT) {
    throw new Error(`--limit exceeds hard cap ${HARD_CAP_LIMIT}`)
  }
  return parsed
}

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('Audit log RLS diagnostics (read-only)\n')

  const limit = parseLimit(getArgValue('--limit') ?? process.env.TEST_AUDIT_LOG_LIMIT ?? null, 5)
  console.log(`Limit: ${limit}\n`)

  const adminSupabase = createAdminClient()

  console.log('1) Checking audit_logs read access (admin client)...')
  const { data: logs, error: readError } = await adminSupabase
    .from('audit_logs')
    .select('id, operation_type, resource_type, operation_status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (readError) {
    throw new Error(`Read access failed: ${readError.message}`)
  }
  console.log(`✅ Read access OK. Found ${logs?.length ?? 0} recent logs.\n`)

  console.log('2) Checking policies for audit_logs...')
  const { data: policies, error: policyError } = await adminSupabase
    .rpc('get_policies_for_table', { table_name: 'audit_logs' })
    .single()

  if (policyError) {
    console.log('RPC get_policies_for_table unavailable or failed; attempting pg_policies fallback...')
    const { data: policyRows, error: pgError } = await adminSupabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'audit_logs')

    if (pgError) {
      // Fail closed: policy lookup is part of the diagnostic intent; do not silently succeed.
      throw new Error(
        `Policy lookup failed via get_policies_for_table RPC (${policyError.message}) and pg_policies fallback (${pgError.message})`
      )
    }

    console.log(`✅ Policies found: ${policyRows?.length ?? 0}`)
    for (const policy of policyRows ?? []) {
      console.log(`- ${policy.policyname} (${policy.cmd})`)
    }
    console.log('\n✅ Read-only audit log RLS diagnostics completed.')
    return
  }

  console.log('✅ Policies payload:', JSON.stringify(policies, null, 2))

  console.log('\n✅ Read-only audit log RLS diagnostics completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
