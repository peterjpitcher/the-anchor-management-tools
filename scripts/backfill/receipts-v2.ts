#!/usr/bin/env tsx
/**
 * Backfill Receipts v2 operational data.
 *
 * Dry-run by default. Mutation mode requires:
 *   RUN_RECEIPTS_V2_BACKFILL=true ALLOW_RECEIPTS_V2_BACKFILL_SCRIPT=true \
 *     scripts/backfill/receipts-v2.ts --confirm
 */

import { createHash } from 'crypto'
import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyAutomationRules } from '@/services/receipts/receiptMutations'
import {
  performDetectReceiptRuleConflicts,
  performSuggestReceiptRules,
  resolveReceiptVendorId,
} from '@/services/receipts/receiptGovernance'
import { performReconcileReceiptInvoicePayments } from '@/services/receipts/receiptInvoiceReconciliation'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'receipts-v2-backfill'
const RUN_MUTATION_ENV = 'RUN_RECEIPTS_V2_BACKFILL'
const ALLOW_MUTATION_ENV = 'ALLOW_RECEIPTS_V2_BACKFILL_SCRIPT'
const PAGE_SIZE = 500

type SupabaseAdmin = ReturnType<typeof createAdminClient>

type Args = {
  dryRun: boolean
  confirm: boolean
  skipRules: boolean
  skipHistorical: boolean
  skipFiles: boolean
  skipDiagnostics: boolean
  skipInvoices: boolean
}

type IdRow = { id: string }
type VendorBackfillRow = { id: string; vendor_name: string | null }
type RuleVendorBackfillRow = { id: string; set_vendor_name: string | null }
type ReceiptFileHashRow = {
  id: string
  storage_path: string
  file_name: string
  file_size_bytes: number | null
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const confirm = argv.includes('--confirm')
  return {
    confirm,
    dryRun: !confirm || argv.includes('--dry-run'),
    skipRules: argv.includes('--skip-rules'),
    skipHistorical: argv.includes('--skip-historical'),
    skipFiles: argv.includes('--skip-files'),
    skipDiagnostics: argv.includes('--skip-diagnostics'),
    skipInvoices: argv.includes('--skip-invoices'),
  }
}

function requireMutationGuards(args: Args) {
  if (args.dryRun) return
  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: RUN_MUTATION_ENV })
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
}

async function exactCount(
  supabase: SupabaseAdmin,
  table: string,
  applyFilters: (query: any) => any = (query) => query,
): Promise<number> {
  const { count, error } = await applyFilters(
    supabase.from(table).select('*', { count: 'exact', head: true }),
  )
  if (error) {
    throw new Error(`[${SCRIPT_NAME}] count ${table} failed: ${error.message}`)
  }
  return count ?? 0
}

async function fetchAll<T>(
  supabase: SupabaseAdmin,
  table: string,
  select: string,
  applyFilters: (query: any) => any = (query) => query,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0

  while (true) {
    const { data, error } = await applyFilters(
      supabase
        .from(table)
        .select(select)
        .range(offset, offset + PAGE_SIZE - 1),
    )

    if (error) {
      throw new Error(`[${SCRIPT_NAME}] fetch ${table} failed: ${error.message}`)
    }

    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

async function printCoverage(supabase: SupabaseAdmin, label: string) {
  const [
    transactionCount,
    labelledTransactions,
    labelledWithVendorId,
    labelledMissingVendorId,
    rulesWithVendorText,
    rulesMissingVendorId,
    filesMissingHash,
  ] = await Promise.all([
    exactCount(supabase, 'receipt_transactions'),
    exactCount(supabase, 'receipt_transactions', (query) => query.not('vendor_name', 'is', null)),
    exactCount(supabase, 'receipt_transactions', (query) => query.not('vendor_name', 'is', null).not('vendor_id', 'is', null)),
    exactCount(supabase, 'receipt_transactions', (query) => query.not('vendor_name', 'is', null).is('vendor_id', null)),
    exactCount(supabase, 'receipt_rules', (query) => query.not('set_vendor_name', 'is', null)),
    exactCount(supabase, 'receipt_rules', (query) => query.not('set_vendor_name', 'is', null).is('vendor_id', null)),
    exactCount(supabase, 'receipt_files', (query) => query.or('content_hash.is.null,hash_verified_at.is.null')),
  ])

  console.log(`[${SCRIPT_NAME}] ${label} coverage`)
  console.log(`  transactions: ${transactionCount}`)
  console.log(`  labelled tx: ${labelledTransactions}`)
  console.log(`  labelled tx with vendor_id: ${labelledWithVendorId}`)
  console.log(`  labelled tx missing vendor_id: ${labelledMissingVendorId}`)
  console.log(`  rules with set_vendor_name: ${rulesWithVendorText}`)
  console.log(`  rules missing vendor_id: ${rulesMissingVendorId}`)
  console.log(`  receipt files missing verified hash: ${filesMissingHash}`)
}

async function backfillCanonicalVendorIds(supabase: SupabaseAdmin, args: Args) {
  const transactionRows = await fetchAll<VendorBackfillRow>(
    supabase,
    'receipt_transactions',
    'id, vendor_name',
    (query) => query.not('vendor_name', 'is', null).is('vendor_id', null),
  )
  const ruleRows = await fetchAll<RuleVendorBackfillRow>(
    supabase,
    'receipt_rules',
    'id, set_vendor_name',
    (query) => query.not('set_vendor_name', 'is', null).is('vendor_id', null),
  )

  console.log(`[${SCRIPT_NAME}] canonical vendor_id backfill candidates: ${transactionRows.length} tx, ${ruleRows.length} rules`)
  if (args.dryRun) return

  let transactionUpdated = 0
  for (const row of transactionRows) {
    if (!row.vendor_name?.trim()) continue
    const vendorId = await resolveReceiptVendorId(supabase, row.vendor_name)
    if (!vendorId) continue
    const { error } = await supabase
      .from('receipt_transactions')
      .update({ vendor_id: vendorId })
      .eq('id', row.id)
    if (error) {
      throw new Error(`[${SCRIPT_NAME}] transaction vendor_id update failed (${row.id}): ${error.message}`)
    }
    transactionUpdated += 1
  }

  let rulesUpdated = 0
  for (const row of ruleRows) {
    if (!row.set_vendor_name?.trim()) continue
    const vendorId = await resolveReceiptVendorId(supabase, row.set_vendor_name)
    if (!vendorId) continue
    const { error } = await supabase
      .from('receipt_rules')
      .update({ vendor_id: vendorId })
      .eq('id', row.id)
    if (error) {
      throw new Error(`[${SCRIPT_NAME}] rule vendor_id update failed (${row.id}): ${error.message}`)
    }
    rulesUpdated += 1
  }

  console.log(`[${SCRIPT_NAME}] canonical vendor_id updated: ${transactionUpdated} tx, ${rulesUpdated} rules`)
}

async function runRuleBackfill(supabase: SupabaseAdmin, args: Args) {
  if (args.skipRules) {
    console.log(`[${SCRIPT_NAME}] skipping rule backfill`)
    return
  }

  const pendingIds = (await fetchAll<IdRow>(
    supabase,
    'receipt_transactions',
    'id',
    (query) => query.eq('status', 'pending').order('transaction_date', { ascending: false }),
  )).map((row) => row.id)
  const closedIds = (await fetchAll<IdRow>(
    supabase,
    'receipt_transactions',
    'id',
    (query) => query.neq('status', 'pending').order('transaction_date', { ascending: false }),
  )).map((row) => row.id)

  console.log(`[${SCRIPT_NAME}] rule backfill candidates: ${pendingIds.length} pending, ${closedIds.length} closed`)
  if (args.dryRun) return

  if (pendingIds.length) {
    const result = await applyAutomationRules(pendingIds, {
      includeClosed: false,
      overrideManual: false,
      allowClosedStatusUpdates: false,
    })
    console.log(`[${SCRIPT_NAME}] pending rule backfill: ${JSON.stringify(result)}`)
  }

  if (!args.skipHistorical && closedIds.length) {
    const result = await applyAutomationRules(closedIds, {
      includeClosed: true,
      overrideManual: false,
      allowClosedStatusUpdates: false,
    })
    console.log(`[${SCRIPT_NAME}] historical classification-only rule backfill: ${JSON.stringify(result)}`)
  }
}

async function backfillFileHashes(supabase: SupabaseAdmin, args: Args) {
  if (args.skipFiles) {
    console.log(`[${SCRIPT_NAME}] skipping file hash backfill`)
    return
  }

  const files = await fetchAll<ReceiptFileHashRow>(
    supabase,
    'receipt_files',
    'id, storage_path, file_name, file_size_bytes',
    (query) => query.or('content_hash.is.null,hash_verified_at.is.null').order('uploaded_at', { ascending: true }),
  )
  const totalBytes = files.reduce((sum, file) => sum + Number(file.file_size_bytes ?? 0), 0)

  console.log(`[${SCRIPT_NAME}] file hash candidates: ${files.length} files (${totalBytes} bytes recorded)`)
  if (args.dryRun) return

  let updated = 0
  const failures: string[] = []

  for (const file of files) {
    const { data, error } = await supabase.storage
      .from('receipts')
      .download(file.storage_path)

    if (error || !data) {
      failures.push(`${file.id}: download failed (${error?.message ?? 'empty response'})`)
      continue
    }

    const hash = createHash('sha256')
      .update(Buffer.from(await data.arrayBuffer()))
      .digest('hex')

    const { error: updateError } = await supabase
      .from('receipt_files')
      .update({
        content_hash: hash,
        hash_verified_at: new Date().toISOString(),
      })
      .eq('id', file.id)

    if (updateError) {
      failures.push(`${file.id}: update failed (${updateError.message})`)
      continue
    }

    updated += 1
    if (updated % 25 === 0 || updated === files.length) {
      console.log(`[${SCRIPT_NAME}] hashed ${updated}/${files.length} files`)
    }
  }

  console.log(`[${SCRIPT_NAME}] file hashes updated: ${updated}; failures: ${failures.length}`)
  if (failures.length) {
    throw new Error(`[${SCRIPT_NAME}] file hash failures: ${failures.slice(0, 5).join(' | ')}`)
  }
}

async function runDiagnostics(supabase: SupabaseAdmin, args: Args) {
  if (args.skipDiagnostics) {
    console.log(`[${SCRIPT_NAME}] skipping diagnostics`)
    return
  }

  console.log(`[${SCRIPT_NAME}] diagnostics jobs: conflict detection, rule suggestions, duplicate candidate refresh`)
  if (args.dryRun) return

  const conflictResult = await performDetectReceiptRuleConflicts()
  console.log(`[${SCRIPT_NAME}] rule conflicts: ${JSON.stringify(conflictResult)}`)

  const suggestionResult = await performSuggestReceiptRules()
  console.log(`[${SCRIPT_NAME}] rule suggestions: ${JSON.stringify(suggestionResult)}`)

  const { error: refreshError } = await supabase.rpc('refresh_receipt_duplicate_candidates')
  if (refreshError) {
    throw new Error(`[${SCRIPT_NAME}] duplicate candidate refresh failed: ${refreshError.message}`)
  }

  const duplicateCandidateCount = await exactCount(supabase, 'receipt_duplicate_candidates')
  console.log(`[${SCRIPT_NAME}] duplicate candidates after refresh: ${duplicateCandidateCount}`)
}

async function runInvoiceReconciliation(args: Args) {
  if (args.skipInvoices) {
    console.log(`[${SCRIPT_NAME}] skipping invoice reconciliation`)
    return
  }

  console.log(`[${SCRIPT_NAME}] invoice reconciliation`)
  if (args.dryRun) return

  const result = await performReconcileReceiptInvoicePayments()
  console.log(`[${SCRIPT_NAME}] invoice reconciliation result: ${JSON.stringify(result)}`)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  dotenv.config({ path: path.resolve(process.cwd(), '.env') })

  const args = parseArgs()
  requireMutationGuards(args)

  console.log(`[${SCRIPT_NAME}] Mode: ${args.dryRun ? 'DRY RUN' : 'MUTATION'}`)
  console.log(`[${SCRIPT_NAME}] Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'missing'}`)

  const supabase = createAdminClient()
  await printCoverage(supabase, 'before')
  await backfillCanonicalVendorIds(supabase, args)
  await runRuleBackfill(supabase, args)
  await runInvoiceReconciliation(args)
  await backfillFileHashes(supabase, args)
  await runDiagnostics(supabase, args)
  await printCoverage(supabase, 'after')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
