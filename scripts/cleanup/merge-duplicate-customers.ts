#!/usr/bin/env tsx

/**
 * merge-duplicate-customers (safe by default)
 *
 * Merges duplicate customer rows that resolve to the same canonical phone number.
 * The script is conflict-aware and will skip unsafe merges (for example, bookings
 * conflicts on the same event).
 *
 * Dry-run (default):
 *   tsx scripts/cleanup/merge-duplicate-customers.ts
 *
 * Mutation mode (requires multi-gating + explicit caps):
 *   RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION=true \
 *   ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT=true \
 *     tsx scripts/cleanup/merge-duplicate-customers.ts --confirm --limit 10 [--offset 0]
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { formatPhoneForStorage } from '../../src/lib/utils'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import {
  assertMergeDuplicateCustomersLimit,
  assertMergeDuplicateCustomersMutationAllowed,
  isMergeDuplicateCustomersMutationEnabled,
  readMergeDuplicateCustomersLimit,
  readMergeDuplicateCustomersOffset
} from '../../src/lib/merge-duplicate-customers-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile_number: string | null
  mobile_e164: string | null
  created_at: string | null
  sms_opt_in: boolean | null
  sms_status: string | null
}

type DuplicateSet = {
  canonicalPhone: string
  rows: CustomerRow[]
}

type DedupeRule = {
  table: 'customer_label_assignments' | 'customer_category_stats' | 'event_check_ins' | 'loyalty_members'
  keyColumn: 'label_id' | 'category_id' | 'event_id' | 'program_id'
}

const MOVE_TABLES = [
  'bookings',
  'customer_label_assignments',
  'customer_category_stats',
  'event_check_ins',
  'loyalty_members',
  'messages',
  'parking_bookings',
  'pending_bookings',
  'private_bookings',
  'reminder_processing_logs',
  'table_bookings'
] as const

const DEDUPE_RULES: DedupeRule[] = [
  { table: 'customer_label_assignments', keyColumn: 'label_id' },
  { table: 'customer_category_stats', keyColumn: 'category_id' },
  { table: 'event_check_ins', keyColumn: 'event_id' },
  { table: 'loyalty_members', keyColumn: 'program_id' }
]

function isFlagPresent(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag)
}

function toCanonicalPhone(row: Pick<CustomerRow, 'mobile_e164' | 'mobile_number'>): string | null {
  const rawPhone = row.mobile_e164 || row.mobile_number
  if (!rawPhone) return null

  try {
    return formatPhoneForStorage(rawPhone)
  } catch {
    return null
  }
}

function isMeaningfulLastName(lastName: string | null | undefined): boolean {
  const normalized = lastName?.trim().toLowerCase()
  if (!normalized) return false
  if (normalized === '.' || normalized === 'guest' || normalized === 'unknown') return false
  return true
}

function hasNonEmptyValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function scoreCustomer(row: CustomerRow, canonicalPhone: string): number {
  let score = 0
  if (row.mobile_e164 === canonicalPhone) score += 8
  if (hasNonEmptyValue(row.email)) score += 4
  if (isMeaningfulLastName(row.last_name)) score += 3
  if (row.sms_status === 'active') score += 2
  if (row.sms_opt_in) score += 1
  return score
}

function createdAtMillis(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function chooseWinner(set: DuplicateSet): CustomerRow {
  return [...set.rows].sort((a, b) => {
    const scoreA = scoreCustomer(a, set.canonicalPhone)
    const scoreB = scoreCustomer(b, set.canonicalPhone)
    if (scoreA !== scoreB) return scoreB - scoreA

    const createdDiff = createdAtMillis(a.created_at) - createdAtMillis(b.created_at)
    if (createdDiff !== 0) return createdDiff

    return a.id.localeCompare(b.id)
  })[0]
}

function buildDuplicateSets(customers: CustomerRow[]): DuplicateSet[] {
  const byPhone = new Map<string, CustomerRow[]>()

  for (const row of customers) {
    const canonical = toCanonicalPhone(row)
    if (!canonical) continue

    const list = byPhone.get(canonical) ?? []
    list.push(row)
    byPhone.set(canonical, list)
  }

  return [...byPhone.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([canonicalPhone, rows]) => ({
      canonicalPhone,
      rows: [...rows].sort((a, b) => createdAtMillis(a.created_at) - createdAtMillis(b.created_at))
    }))
    .sort((a, b) => a.canonicalPhone.localeCompare(b.canonicalPhone))
}

async function countRowsForCustomer(
  supabase: ReturnType<typeof createAdminClient>,
  table: (typeof MOVE_TABLES)[number] | DedupeRule['table'],
  customerId: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)

  assertScriptQuerySucceeded({
    operation: `Count ${table} rows for customer ${customerId}`,
    error,
    data: count,
    allowMissing: true
  })

  return count ?? 0
}

async function findConflictRowIdsByKey(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: DedupeRule['table']
  keyColumn: DedupeRule['keyColumn']
  winnerId: string
  loserId: string
}): Promise<string[]> {
  const { supabase, table, keyColumn, winnerId, loserId } = params

  const { data: loserRowsData, error: loserRowsError } = await supabase
    .from(table)
    .select(`id, ${keyColumn}`)
    .eq('customer_id', loserId)

  const loserRows = (assertScriptQuerySucceeded({
    operation: `Load ${table} rows for loser ${loserId}`,
    error: loserRowsError,
    data: loserRowsData ?? [],
    allowMissing: true
  }) ?? []) as Array<Record<string, unknown>>

  if (loserRows.length === 0) {
    return []
  }

  const loserKeys = Array.from(
    new Set(
      loserRows
        .map((row) => row[keyColumn])
        .filter((value): value is string | number => value !== null && value !== undefined)
    )
  )

  if (loserKeys.length === 0) {
    return []
  }

  const { data: winnerRowsData, error: winnerRowsError } = await supabase
    .from(table)
    .select(keyColumn)
    .eq('customer_id', winnerId)
    .in(keyColumn, loserKeys as string[])

  const winnerRows = (assertScriptQuerySucceeded({
    operation: `Load winner ${table} rows for conflict detection`,
    error: winnerRowsError,
    data: winnerRowsData ?? [],
    allowMissing: true
  }) ?? []) as Array<Record<string, unknown>>

  if (winnerRows.length === 0) {
    return []
  }

  const winnerKeySet = new Set(
    winnerRows
      .map((row) => row[keyColumn])
      .filter((value): value is string | number => value !== null && value !== undefined)
      .map((value) => String(value))
  )

  return loserRows
    .filter((row) => {
      const value = row[keyColumn]
      return value !== null && value !== undefined && winnerKeySet.has(String(value))
    })
    .map((row) => String(row.id))
}

async function deleteRowsByIds(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: DedupeRule['table']
  ids: string[]
  mutationEnabled: boolean
}): Promise<number> {
  const uniqueIds = Array.from(new Set(params.ids.filter(Boolean)))
  if (uniqueIds.length === 0) return 0

  if (!params.mutationEnabled) {
    return uniqueIds.length
  }

  const { data: deletedRows, error: deleteError } = await params.supabase
    .from(params.table)
    .delete()
    .in('id', uniqueIds)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Delete ${params.table} conflict rows`,
    error: deleteError,
    updatedRows: deletedRows as Array<{ id?: string }> | null,
    allowZeroRows: false
  })

  assertScriptExpectedRowCount({
    operation: `Delete ${params.table} conflict rows`,
    expected: uniqueIds.length,
    actual: updatedCount
  })

  return updatedCount
}

async function moveRowsForCustomer(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: (typeof MOVE_TABLES)[number]
  fromCustomerId: string
  toCustomerId: string
  mutationEnabled: boolean
}): Promise<number> {
  const expected = await countRowsForCustomer(params.supabase, params.table, params.fromCustomerId)
  if (expected === 0) {
    return 0
  }

  if (!params.mutationEnabled) {
    return expected
  }

  const { data: updatedRows, error: updateError } = await params.supabase
    .from(params.table)
    .update({ customer_id: params.toCustomerId })
    .eq('customer_id', params.fromCustomerId)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Move ${params.table} rows from ${params.fromCustomerId} to ${params.toCustomerId}`,
    error: updateError,
    updatedRows: updatedRows as Array<{ id?: string }> | null,
    allowZeroRows: false
  })

  assertScriptExpectedRowCount({
    operation: `Move ${params.table} rows from ${params.fromCustomerId} to ${params.toCustomerId}`,
    expected,
    actual: updatedCount
  })

  return updatedCount
}

async function findBookingEventConflicts(params: {
  supabase: ReturnType<typeof createAdminClient>
  winnerId: string
  loserId: string
}): Promise<string[]> {
  const { supabase, winnerId, loserId } = params
  const { data: bookingRowsData, error: bookingRowsError } = await supabase
    .from('bookings')
    .select('id, event_id, customer_id')
    .in('customer_id', [winnerId, loserId])

  const bookingRows = (assertScriptQuerySucceeded({
    operation: `Load bookings for winner ${winnerId} and loser ${loserId}`,
    error: bookingRowsError,
    data: bookingRowsData ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; event_id: string | null; customer_id: string }>

  const byEvent = new Map<string, Set<string>>()
  for (const row of bookingRows) {
    if (!row.event_id) continue
    const set = byEvent.get(row.event_id) ?? new Set<string>()
    set.add(row.customer_id)
    byEvent.set(row.event_id, set)
  }

  return [...byEvent.entries()]
    .filter(([, customerIds]) => customerIds.has(winnerId) && customerIds.has(loserId))
    .map(([eventId]) => eventId)
}

async function deleteLoserCustomer(params: {
  supabase: ReturnType<typeof createAdminClient>
  loserId: string
  mutationEnabled: boolean
}): Promise<number> {
  if (!params.mutationEnabled) {
    return 1
  }

  const { data: deletedRows, error: deleteError } = await params.supabase
    .from('customers')
    .delete()
    .eq('id', params.loserId)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Delete loser customer ${params.loserId}`,
    error: deleteError,
    updatedRows: deletedRows as Array<{ id?: string }> | null,
    allowZeroRows: false
  })

  assertScriptExpectedRowCount({
    operation: `Delete loser customer ${params.loserId}`,
    expected: 1,
    actual: updatedCount
  })

  return updatedCount
}

async function insertMergeAuditLog(params: {
  supabase: ReturnType<typeof createAdminClient>
  loser: CustomerRow
  winnerId: string
  canonicalPhone: string
  movedCounts: Partial<Record<(typeof MOVE_TABLES)[number], number>>
  dedupedCounts: Partial<Record<DedupeRule['table'], number>>
  mutationEnabled: boolean
}): Promise<void> {
  if (!params.mutationEnabled) {
    return
  }

  const payload = {
    user_id: null,
    user_email: 'script@system',
    operation_type: 'update',
    resource_type: 'customer',
    resource_id: params.loser.id,
    operation_status: 'success',
    old_values: {
      customer: params.loser,
      merged_into_customer_id: params.winnerId
    },
    new_values: {
      merged_into_customer_id: params.winnerId
    },
    error_message: null,
    additional_info: {
      script: 'merge-duplicate-customers.ts',
      canonical_phone: params.canonicalPhone,
      moved_counts: params.movedCounts,
      deduped_counts: params.dedupedCounts
    }
  }

  const { data: auditRows, error: auditError } = await params.supabase
    .from('audit_logs')
    .insert(payload)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Insert audit log for merged customer ${params.loser.id}`,
    error: auditError,
    updatedRows: auditRows as Array<{ id?: string }> | null,
    allowZeroRows: false
  })

  assertScriptExpectedRowCount({
    operation: `Insert audit log for merged customer ${params.loser.id}`,
    expected: 1,
    actual: updatedCount
  })
}

async function enrichWinnerFromLoser(params: {
  supabase: ReturnType<typeof createAdminClient>
  winner: CustomerRow
  loser: CustomerRow
  canonicalPhone: string
  mutationEnabled: boolean
}): Promise<CustomerRow> {
  const emailCandidate = hasNonEmptyValue(params.loser.email)
    ? params.loser.email!.trim().toLowerCase()
    : null
  const lastNameCandidate = isMeaningfulLastName(params.loser.last_name)
    ? params.loser.last_name!.trim()
    : null

  const updatePayload: Record<string, string> = {}

  if (!hasNonEmptyValue(params.winner.email) && emailCandidate) {
    updatePayload.email = emailCandidate
  }
  if (!isMeaningfulLastName(params.winner.last_name) && lastNameCandidate) {
    updatePayload.last_name = lastNameCandidate
  }

  if (Object.keys(updatePayload).length === 0) {
    return params.winner
  }

  if (!params.mutationEnabled) {
    return {
      ...params.winner,
      email: (updatePayload.email as string | undefined) ?? params.winner.email,
      last_name: (updatePayload.last_name as string | undefined) ?? params.winner.last_name
    }
  }

  const { data: updatedWinner, error: updateError } = await params.supabase
    .from('customers')
    .update(updatePayload)
    .eq('id', params.winner.id)
    .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at, sms_opt_in, sms_status')
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed enriching winner customer ${params.winner.id}: ${updateError.message}`)
  }
  if (!updatedWinner) {
    throw new Error(`Winner enrichment affected no rows for customer ${params.winner.id}`)
  }

  return updatedWinner as CustomerRow
}

async function backfillWinnerCanonicalPhone(params: {
  supabase: ReturnType<typeof createAdminClient>
  winner: CustomerRow
  canonicalPhone: string
  mutationEnabled: boolean
}): Promise<CustomerRow> {
  if (params.winner.mobile_e164) {
    return params.winner
  }

  if (!params.mutationEnabled) {
    return {
      ...params.winner,
      mobile_e164: params.canonicalPhone
    }
  }

  const { data: conflictingRows, error: conflictError } = await params.supabase
    .from('customers')
    .select('id')
    .eq('mobile_e164', params.canonicalPhone)
    .neq('id', params.winner.id)
    .limit(1)

  if (conflictError) {
    throw new Error(
      `Failed checking winner canonical-phone conflicts for ${params.winner.id}: ${conflictError.message}`
    )
  }

  if (conflictingRows && conflictingRows.length > 0) {
    return params.winner
  }

  const { data: updatedWinner, error: updateError } = await params.supabase
    .from('customers')
    .update({ mobile_e164: params.canonicalPhone })
    .eq('id', params.winner.id)
    .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at, sms_opt_in, sms_status')
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed backfilling winner mobile_e164 for ${params.winner.id}: ${updateError.message}`)
  }
  if (!updatedWinner) {
    throw new Error(`Winner mobile_e164 backfill affected no rows for ${params.winner.id}`)
  }

  return updatedWinner as CustomerRow
}

async function run(): Promise<void> {
  const argv = process.argv
  const confirm = isFlagPresent('--confirm', argv)
  const mutationEnabled = isMergeDuplicateCustomersMutationEnabled(argv, process.env)
  const HARD_CAP = 100

  if (isFlagPresent('--help', argv)) {
    console.log(`
merge-duplicate-customers (safe by default)

Dry-run (default):
  tsx scripts/cleanup/merge-duplicate-customers.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION=true \\
  ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT=true \\
    tsx scripts/cleanup/merge-duplicate-customers.ts --confirm --limit 10 [--offset 0]

Notes:
  - --limit is required in mutation mode (hard cap ${HARD_CAP} duplicate sets per run).
  - Bookings conflicts on the same event are skipped for manual resolution.
`)
    return
  }

  if (confirm && !mutationEnabled && !isFlagPresent('--dry-run', argv)) {
    throw new Error(
      'merge-duplicate-customers received --confirm but RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION is not enabled. Set RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION=true and ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT=true to apply merges.'
    )
  }

  let offset = readMergeDuplicateCustomersOffset(argv, process.env) ?? 0
  let limit = readMergeDuplicateCustomersLimit(argv, process.env)

  if (mutationEnabled) {
    assertMergeDuplicateCustomersMutationAllowed(process.env)
    limit = assertMergeDuplicateCustomersLimit(limit, HARD_CAP)
  }

  const supabase = createAdminClient()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'
  console.log(`🧹 merge-duplicate-customers (${modeLabel})`)

  const { data: customersData, error: customersError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at, sms_opt_in, sms_status')
    .order('created_at', { ascending: true })

  const customers = (assertScriptQuerySucceeded({
    operation: 'Load customers for duplicate merge analysis',
    error: customersError,
    data: customersData ?? [],
    allowMissing: true
  }) ?? []) as CustomerRow[]

  const duplicateSets = buildDuplicateSets(customers)
  console.log(`Customers scanned: ${customers.length}`)
  console.log(`Duplicate sets found: ${duplicateSets.length}`)

  if (duplicateSets.length === 0) {
    console.log('No duplicate sets found.')
    return
  }

  if (offset < 0) offset = 0
  const sliced = duplicateSets.slice(offset, limit ? offset + limit : undefined)

  console.log(`Processing duplicate sets: ${sliced.length}`)
  if (limit !== null && limit !== undefined) {
    console.log(`Window: offset=${offset} limit=${limit}`)
  }

  const failures: string[] = []
  let mergedLoserCount = 0
  let blockedLoserCount = 0
  let plannedLoserCount = 0

  for (const set of sliced) {
    console.log(`\n📱 ${set.canonicalPhone} (${set.rows.length} rows)`)

    let winner = chooseWinner(set)
    const losers = set.rows.filter((row) => row.id !== winner.id)
    console.log(
      `Winner: ${winner.id} (${winner.first_name ?? ''} ${winner.last_name ?? ''})`.trim()
    )

    for (const loser of losers) {
      plannedLoserCount += 1
      console.log(`  → Candidate merge: loser ${loser.id} -> winner ${winner.id}`)

      try {
        const bookingConflictEventIds = await findBookingEventConflicts({
          supabase,
          winnerId: winner.id,
          loserId: loser.id
        })

        if (bookingConflictEventIds.length > 0) {
          blockedLoserCount += 1
          const eventPreview = bookingConflictEventIds.slice(0, 3).join(', ')
          const message = `blocked_booking_conflict:${loser.id}:events=${eventPreview}`
          failures.push(message)
          console.warn(`    ⚠️ Skipping: booking conflict on event(s): ${eventPreview}`)
          continue
        }

        const dedupedCounts: Partial<Record<DedupeRule['table'], number>> = {}
        for (const rule of DEDUPE_RULES) {
          const conflictIds = await findConflictRowIdsByKey({
            supabase,
            table: rule.table,
            keyColumn: rule.keyColumn,
            winnerId: winner.id,
            loserId: loser.id
          })
          if (conflictIds.length === 0) {
            dedupedCounts[rule.table] = 0
            continue
          }

          const deletedCount = await deleteRowsByIds({
            supabase,
            table: rule.table,
            ids: conflictIds,
            mutationEnabled
          })
          dedupedCounts[rule.table] = deletedCount
          console.log(`    ${rule.table}: deduped ${deletedCount}`)
        }

        const movedCounts: Partial<Record<(typeof MOVE_TABLES)[number], number>> = {}
        for (const table of MOVE_TABLES) {
          const moved = await moveRowsForCustomer({
            supabase,
            table,
            fromCustomerId: loser.id,
            toCustomerId: winner.id,
            mutationEnabled
          })
          movedCounts[table] = moved
          if (moved > 0) {
            console.log(`    ${table}: moved ${moved}`)
          }
        }

        await deleteLoserCustomer({
          supabase,
          loserId: loser.id,
          mutationEnabled
        })

        winner = await enrichWinnerFromLoser({
          supabase,
          winner,
          loser,
          canonicalPhone: set.canonicalPhone,
          mutationEnabled
        })

        await insertMergeAuditLog({
          supabase,
          loser,
          winnerId: winner.id,
          canonicalPhone: set.canonicalPhone,
          movedCounts,
          dedupedCounts,
          mutationEnabled
        })

        mergedLoserCount += 1
        console.log(`    ✅ Merged loser ${loser.id}`)
      } catch (error) {
        blockedLoserCount += 1
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`merge_failed:${loser.id}:${message}`)
        console.error(`    ❌ Failed merge for loser ${loser.id}: ${message}`)
      }
    }

    try {
      winner = await backfillWinnerCanonicalPhone({
        supabase,
        winner,
        canonicalPhone: set.canonicalPhone,
        mutationEnabled
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`winner_phone_backfill_failed:${winner.id}:${message}`)
      console.error(`    ❌ Failed winner canonical phone backfill for ${winner.id}: ${message}`)
    }
  }

  console.log('\nSummary')
  console.log(`- Duplicate sets processed: ${sliced.length}`)
  console.log(`- Loser rows considered: ${plannedLoserCount}`)
  console.log(`- Loser rows merged: ${mergedLoserCount}`)
  console.log(`- Loser rows blocked/failed: ${blockedLoserCount}`)

  if (!mutationEnabled && failures.length > 0) {
    console.log(`- Dry-run blockers/failures observed: ${failures.length}`)
  }

  if (mutationEnabled) {
    assertScriptCompletedWithoutFailures({
      scriptName: 'merge-duplicate-customers',
      failureCount: failures.length,
      failures
    })
  }
}

run().catch((error) => {
  console.error('merge-duplicate-customers failed:', error)
  process.exitCode = 1
})
