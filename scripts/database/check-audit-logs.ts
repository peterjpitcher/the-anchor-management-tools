#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 50

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 10
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > HARD_CAP) {
    throw new Error(`--limit too high (got ${parsed}, hard cap ${HARD_CAP})`)
  }
  return parsed
}

function parseResourceType(argv: string[]): string {
  const idx = argv.indexOf('--resource-type')
  if (idx === -1) {
    return 'employee'
  }
  const value = argv[idx + 1]
  if (!value || value.trim().length === 0) {
    throw new Error('Missing value for --resource-type')
  }
  return value.trim()
}

async function checkAuditLogs() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-audit-logs is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)
  const resourceType = parseResourceType(argv)
  const showAdditionalInfo = argv.includes('--show-additional-info')

  console.log(`Checking audit_logs for resource_type='${resourceType}'...\n`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Show additional_info: ${showAdditionalInfo ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: logsRows, error: logsError } = await supabase
    .from('audit_logs')
    .select(
      'id, operation_type, resource_type, resource_id, user_email, operation_status, created_at, additional_info'
    )
    .eq('resource_type', resourceType)
    .order('created_at', { ascending: false })
    .limit(limit)

  const logs = (assertScriptQuerySucceeded({
    operation: 'Load audit logs',
    error: logsError,
    data: logsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    operation_type: string | null
    resource_type: string | null
    resource_id: string | null
    user_email: string | null
    operation_status: string | null
    created_at: string | null
    additional_info: unknown
  }>

  console.log(`Found ${logs.length} audit log(s):\n`)

  if (logs.length === 0) {
    console.log('No audit logs found.')
    return
  }

  logs.forEach((log, i) => {
    console.log(`Log ${i + 1}:`)
    console.log(`  ID: ${log.id}`)
    console.log(`  Operation: ${log.operation_type || 'unknown'}`)
    console.log(`  Resource: ${log.resource_type || 'unknown'}`)
    console.log(`  Resource ID: ${log.resource_id || 'unknown'}`)
    console.log(`  User: ${log.user_email || 'System'}`)
    console.log(`  Status: ${log.operation_status || 'unknown'}`)
    console.log(`  Created: ${log.created_at ? new Date(log.created_at).toLocaleString() : 'unknown'}`)
    if (showAdditionalInfo && log.additional_info) {
      console.log(`  Additional Info:`, JSON.stringify(log.additional_info, null, 2))
    }
    console.log('---')
  })
}

void checkAuditLogs().catch((error) => {
  markFailure('check-audit-logs failed.', error)
})
