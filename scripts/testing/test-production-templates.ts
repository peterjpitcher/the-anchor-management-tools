#!/usr/bin/env tsx
/**
 * Production template diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only (select/RPC only).
 * - Fails closed (non-zero exit) on any env/query/RPC failure.
 * - Does not support `--confirm`.
 *
 * Notes:
 * - This script runs against the Supabase project configured in `.env.local`.
 * - Use `--event-id` to test an event-specific template lookup; otherwise the all-zero UUID is used.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-production-templates'
const DEFAULT_EVENT_ID = '00000000-0000-0000-0000-000000000000'
const DEFAULT_TYPES = ['booking_confirmation', 'booking_reminder_confirmation']
const HARD_CAP_LIMIT = 50

type Args = {
  eventId: string
  types: string[]
  limit: number
}

function findFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) return eq.split('=')[1] ?? null

  const idx = argv.indexOf(flag)
  if (idx === -1) return null

  const value = argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parsePositiveInt(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: ${value}`)
  }
  if (parsed > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap ${HARD_CAP_LIMIT}`)
  }
  return parsed
}

function readArgs(argv = process.argv.slice(2)): Args {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm`)
  }

  const eventId = (findFlagValue(argv, '--event-id') ?? process.env.TEST_TEMPLATE_EVENT_ID ?? DEFAULT_EVENT_ID).trim()
  if (!eventId) {
    throw new Error(`[${SCRIPT_NAME}] Missing --event-id (or TEST_TEMPLATE_EVENT_ID)`)
  }

  const typesCsv = findFlagValue(argv, '--types') ?? process.env.TEST_TEMPLATE_TYPES ?? null
  const types = typesCsv
    ? typesCsv
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [...DEFAULT_TYPES]

  const limit = parsePositiveInt(findFlagValue(argv, '--limit') ?? process.env.TEST_TEMPLATE_LIMIT ?? null, 20)

  return { eventId, types, limit }
}

async function run(): Promise<void> {
  const args = readArgs()

  console.log(`[${SCRIPT_NAME}] starting (read-only)\n`)
  console.log(`eventId: ${args.eventId}`)
  console.log(`types: ${args.types.join(', ')}`)
  console.log(`limit: ${args.limit}\n`)

  const supabase = createAdminClient()
  let failures = 0

  console.log('1) Listing message_templates rows...')
  const { data: templates, error: templatesError } = await supabase
    .from('message_templates')
    .select('id, name, template_type, is_default, is_active, content, updated_at')
    .in('template_type', args.types)
    .order('template_type')
    .order('is_default', { ascending: false })
    .limit(args.limit)

  const templateRows =
    assertScriptQuerySucceeded({
      operation: 'select message_templates',
      error: templatesError,
      data: templates,
      allowMissing: true,
    }) ?? []

  if (templateRows.length === 0) {
    console.error('❌ No message_templates found for requested template types.')
    failures += 1
  } else {
    for (const row of templateRows as any[]) {
      const preview = typeof row?.content === 'string' ? row.content.slice(0, 80) : ''
      console.log(`- ${row.template_type} :: ${row.name} (default=${row.is_default}, active=${row.is_active})`)
      console.log(`  id=${row.id} updated_at=${row.updated_at ?? 'N/A'}`)
      console.log(`  content=${preview}${preview.length === 80 ? '...' : ''}`)
    }
  }

  console.log('\n2) Testing get_message_template RPC...')
  for (const templateType of args.types) {
    console.log(`\nRPC: ${templateType}`)
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_message_template', {
      p_event_id: args.eventId,
      p_template_type: templateType,
    })

    const rpcRows =
      assertScriptQuerySucceeded({
        operation: `rpc get_message_template (${templateType})`,
        error: rpcError,
        data: rpcData,
        allowMissing: true,
      }) ?? []

    if (!Array.isArray(rpcRows) || rpcRows.length === 0) {
      console.error(`❌ RPC returned no rows for ${templateType}`)
      failures += 1
      continue
    }

    const first = rpcRows[0] as any
    const content = typeof first?.content === 'string' ? first.content : ''
    if (!content) {
      console.error(`❌ RPC returned empty content for ${templateType}`)
      failures += 1
      continue
    }

    console.log(`✅ content preview: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`)
    console.log(`variables: ${Array.isArray(first?.variables) ? first.variables.join(', ') : 'N/A'}`)
    console.log(`send_timing: ${first?.send_timing ?? 'N/A'} custom_timing_hours: ${first?.custom_timing_hours ?? 'N/A'}`)
  }

  if (failures > 0) {
    throw new Error(`[${SCRIPT_NAME}] completed with ${failures} failure(s)`)
  }

  console.log(`\n✅ [${SCRIPT_NAME}] completed successfully.`)
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
