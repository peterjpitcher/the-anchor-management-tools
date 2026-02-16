#!/usr/bin/env tsx

/**
 * Test SMS template loading fallback behavior (read-only).
 *
 * Safety:
 * - Strictly read-only (select/RPC only).
 * - Fails closed (non-zero exit) on any env/query/RPC failure.
 * - Does not support `--confirm`.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-production-template-fix'
const DEFAULT_EVENT_ID = '00000000-0000-0000-0000-000000000000'
const DEFAULT_TYPES = ['booking_confirmation', 'booking_reminder_confirmation']

type Args = {
  eventIdOverride: string | null
  types: string[]
}

function findFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) return eq.split('=')[1] ?? null

  const idx = argv.indexOf(flag)
  if (idx === -1) return null

  const value = argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readArgs(argv = process.argv.slice(2)): Args {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm`)
  }

  const eventIdOverride = (findFlagValue(argv, '--event-id') ?? process.env.TEST_TEMPLATE_EVENT_ID ?? '').trim() || null
  const typesCsv = findFlagValue(argv, '--types') ?? process.env.TEST_TEMPLATE_TYPES ?? null
  const types = typesCsv
    ? typesCsv
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [...DEFAULT_TYPES]

  return { eventIdOverride, types }
}

async function checkRpc(supabase: any, eventId: string, templateType: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_message_template', {
    p_event_id: eventId,
    p_template_type: templateType,
  })

  const rows =
    assertScriptQuerySucceeded({
      operation: `rpc get_message_template (${templateType}, eventId=${eventId})`,
      error,
      data,
      allowMissing: true,
    }) ?? []

  const first = Array.isArray(rows) ? (rows[0] as any) : null
  const content = typeof first?.content === 'string' ? first.content : ''
  if (!content) {
    console.error(`❌ Missing content for template_type=${templateType} eventId=${eventId}`)
    return false
  }

  console.log(`✅ ${templateType} content preview: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`)
  return true
}

async function run(): Promise<void> {
  const args = readArgs()

  console.log(`[${SCRIPT_NAME}] starting (read-only)\n`)

  const supabase = createAdminClient()
  let failures = 0

  console.log(`Test A: global fallback using eventId=${DEFAULT_EVENT_ID}`)
  for (const templateType of args.types) {
    const ok = await checkRpc(supabase, DEFAULT_EVENT_ID, templateType)
    if (!ok) failures += 1
  }

  if (args.eventIdOverride && args.eventIdOverride !== DEFAULT_EVENT_ID) {
    console.log(`\nTest B: override using eventId=${args.eventIdOverride}`)
    for (const templateType of args.types) {
      const ok = await checkRpc(supabase, args.eventIdOverride, templateType)
      if (!ok) failures += 1
    }
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
