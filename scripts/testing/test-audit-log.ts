#!/usr/bin/env tsx
/**
 * Audit log diagnostics (read-only).
 *
 * Safety note:
 * - Do NOT insert audit logs from scripts; this is production DB mutation risk.
 * - This script is strictly read-only and fails closed on query errors.
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

  console.log('Audit log diagnostics (read-only)\n')

  const resourceType = getArgValue('--resource-type') ?? process.env.TEST_AUDIT_LOG_RESOURCE_TYPE ?? 'employee'
  const resourceId = getArgValue('--resource-id') ?? process.env.TEST_AUDIT_LOG_RESOURCE_ID ?? null
  const limit = parseLimit(getArgValue('--limit') ?? process.env.TEST_AUDIT_LOG_LIMIT ?? null, 10)

  console.log(`Resource type: ${resourceType}`)
  console.log(`Resource id: ${resourceId ?? '(missing)'} (set --resource-id or TEST_AUDIT_LOG_RESOURCE_ID)`)
  console.log(`Limit: ${limit}`)
  console.log('')

  if (!resourceId) {
    throw new Error('Missing required --resource-id (or TEST_AUDIT_LOG_RESOURCE_ID)')
  }

  const supabase = createAdminClient()

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select(
      'id, operation_type, resource_type, resource_id, operation_status, user_email, user_id, created_at, additional_info'
    )
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Audit log lookup failed: ${error.message}`)
  }

  console.log(`Found ${logs?.length ?? 0} audit logs\n`)
  for (const [idx, log] of (logs ?? []).entries()) {
    console.log(`Log ${idx + 1}:`)
    console.log(`- Operation: ${log.operation_type}`)
    console.log(`- Status: ${log.operation_status}`)
    console.log(`- User: ${log.user_email || log.user_id || 'System'}`)
    console.log(`- Created: ${log.created_at}`)
    if (log.additional_info) {
      console.log('- Additional info:', log.additional_info)
    }
    console.log('')
  }

  console.log('✅ Read-only audit log diagnostics completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
