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

const SCRIPT_NAME = 'seed-cashing-up'
const RUN_MUTATION_ENV = 'RUN_SEED_CASHING_UP_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_SEED_CASHING_UP_MUTATION_SCRIPT'
const HARD_CAP = 31

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

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  siteId: string | null
  userId: string | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit') ?? findFlagValue(rest, '--days'))
  const siteId =
    findFlagValue(rest, '--site-id') ?? (typeof process.env.CASHUP_SITE_ID === 'string' ? process.env.CASHUP_SITE_ID : null)
  const userId =
    findFlagValue(rest, '--user-id') ?? (typeof process.env.CASHUP_USER_ID === 'string' ? process.env.CASHUP_USER_ID : null)

  return {
    confirm,
    dryRun,
    limit,
    siteId: typeof siteId === 'string' && siteId.trim().length > 0 ? siteId.trim() : null,
    userId: typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : null,
  }
}

function formatDate(value: Date): string {
  return value.toISOString().split('T')[0]
}

function subtractDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() - days)
  return next
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  const effectiveLimit = args.limit ?? 14
  if (effectiveLimit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.siteId) {
    throw new Error(`[${SCRIPT_NAME}] missing --site-id (or CASHUP_SITE_ID)`)
  }
  if (!args.userId) {
    throw new Error(`[${SCRIPT_NAME}] missing --user-id (or CASHUP_USER_ID)`)
  }

  const { data: siteRow, error: siteError } = await (admin.from('sites') as any)
    .select('id, name')
    .eq('id', args.siteId)
    .maybeSingle()
  const site = assertScriptQuerySucceeded({
    operation: 'Load sites row',
    error: siteError,
    data: siteRow as { id: string; name: string } | null,
  })
  if (!site) {
    throw new Error(`[${SCRIPT_NAME}] site not found for id=${args.siteId}`)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startDate = subtractDays(today, effectiveLimit - 1)
  const startDateStr = formatDate(startDate)
  const endDateStr = formatDate(today)

  const { data: existingRows, error: existingError } = await (admin.from('cashup_sessions') as any)
    .select('id, session_date')
    .eq('site_id', args.siteId)
    .gte('session_date', startDateStr)
    .lte('session_date', endDateStr)

  const existing = assertScriptQuerySucceeded({
    operation: `Load cashup_sessions (${startDateStr}..${endDateStr})`,
    error: existingError,
    data: existingRows as Array<{ id: string; session_date: string }> | null,
    allowMissing: true,
  })

  const existingDates = new Set(
    (existing ?? [])
      .map((row) => (typeof row?.session_date === 'string' ? row.session_date : null))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  )

  const dateCandidates: string[] = []
  for (let i = 0; i < effectiveLimit; i += 1) {
    dateCandidates.push(formatDate(subtractDays(today, i)))
  }

  const plannedDates = dateCandidates.filter((dateStr) => !existingDates.has(dateStr))

  console.log(
    `[${SCRIPT_NAME}] site=${site.name} (${site.id}) user_id=${args.userId} range=${startDateStr}..${endDateStr}`
  )
  console.log(`[${SCRIPT_NAME}] existing sessions in range=${existingDates.size}`)
  console.log(`[${SCRIPT_NAME}] planned new sessions=${plannedDates.length}`)
  if (plannedDates.length > 0) {
    console.log(`[${SCRIPT_NAME}] planned dates: ${plannedDates.join(', ')}`)
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }
  if (args.limit === null) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  let createdSessions = 0

  for (const dateStr of plannedDates) {
    const expectedCash = 500 + Math.random() * 500
    const expectedCard = 1000 + Math.random() * 1000
    const variance = (Math.random() - 0.5) * 20

    const countedCash = expectedCash + (Math.random() > 0.8 ? variance : 0)
    const countedCard = expectedCard

    const { data: sessionRow, error: sessionError } = await (admin.from('cashup_sessions') as any)
      .insert({
        site_id: args.siteId,
        session_date: dateStr,
        shift_code: 'DAY',
        status: 'draft',
        prepared_by_user_id: args.userId,
        created_by_user_id: args.userId,
        updated_by_user_id: args.userId,
        total_expected_amount: expectedCash + expectedCard,
        total_counted_amount: countedCash + countedCard,
        total_variance_amount: countedCash + countedCard - (expectedCash + expectedCard),
        notes: Math.abs(variance) > 5 ? 'Variance noted.' : null,
      })
      .select('id')
      .single()

    const session = assertScriptQuerySucceeded({
      operation: `Insert cashup_sessions(${dateStr})`,
      error: sessionError,
      data: sessionRow as { id: string } | null,
    })

    if (!session?.id) {
      throw new Error(`[${SCRIPT_NAME}] insert cashup_sessions(${dateStr}) did not return an id`)
    }

    const { data: breakdownRows, error: breakdownError } = await (admin.from('cashup_payment_breakdowns') as any)
      .insert([
        {
          cashup_session_id: session.id,
          payment_type_code: 'CASH',
          payment_type_label: 'Cash',
          expected_amount: expectedCash,
          counted_amount: countedCash,
          variance_amount: countedCash - expectedCash,
        },
        {
          cashup_session_id: session.id,
          payment_type_code: 'CARD',
          payment_type_label: 'Card',
          expected_amount: expectedCard,
          counted_amount: countedCard,
          variance_amount: countedCard - expectedCard,
        },
      ])
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Insert cashup_payment_breakdowns(${dateStr})`,
      error: breakdownError,
      updatedRows: breakdownRows as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Insert cashup_payment_breakdowns(${dateStr})`,
      expected: 2,
      actual: updatedCount,
    })

    createdSessions += 1
    console.log(`[${SCRIPT_NAME}] inserted session ${dateStr} (session_id=${session.id})`)
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Created ${createdSessions} sessions.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
