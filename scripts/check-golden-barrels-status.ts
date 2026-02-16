#!/usr/bin/env tsx
/**
 * Golden Barrels account status diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Avoids hard-coded production identifiers; requires explicit targeting when vendor search is ambiguous.
 * - Caps entry sampling via `--limit` (hard cap 2000) and prints when results are capped.
 * - Skips invoice lookups unless `--invoice-number` is provided.
 * - Fails closed on any env/query/RPC error.
 *
 * Usage:
 *   scripts/check-golden-barrels-status.ts [--vendor-id <uuid> | --vendor-ilike "%Golden Barrels%"] [--from-date YYYY-MM-DD] [--limit 500] [--invoice-number INV-001,INV-002]
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'check-golden-barrels-status'
const DEFAULT_VENDOR_ILIKE = '%Golden Barrels%'
const DEFAULT_LIMIT = 500
const HARD_CAP_LIMIT = 2000
const HARD_CAP_INVOICE_NUMBERS = 20

type Args = {
  confirm: boolean
  vendorId: string | null
  vendorIlike: string
  fromDate: string
  limit: number
  invoiceNumbers: string[]
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) return null
  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function assertIsoDate(value: string, label: string): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label}: ${value} (expected YYYY-MM-DD)`)
  }
  return value
}

function daysAgoIso(days: number): string {
  const ms = Math.max(0, Math.floor(days)) * 24 * 60 * 60 * 1000
  return new Date(Date.now() - ms).toISOString().slice(0, 10)
}

function parseInvoiceNumbers(raw: string | null): string[] {
  if (!raw) return []
  const tokens = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const unique = Array.from(new Set(tokens))
  if (unique.length > HARD_CAP_INVOICE_NUMBERS) {
    throw new Error(
      `[${SCRIPT_NAME}] --invoice-number exceeds hard cap (max ${HARD_CAP_INVOICE_NUMBERS})`
    )
  }
  return unique
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')

  const vendorId = readOptionalFlagValue(rest, '--vendor-id')
  const vendorIlike = readOptionalFlagValue(rest, '--vendor-ilike') ?? DEFAULT_VENDOR_ILIKE

  const fromDateRaw = readOptionalFlagValue(rest, '--from-date') ?? daysAgoIso(30)
  const fromDate = assertIsoDate(fromDateRaw, '--from-date')

  const limitRaw = readOptionalFlagValue(rest, '--limit')
  const limit = parsePositiveInt(limitRaw) ?? DEFAULT_LIMIT
  if (limit > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_LIMIT})`)
  }

  const invoiceNumbers = parseInvoiceNumbers(readOptionalFlagValue(rest, '--invoice-number'))

  return { confirm, vendorId, vendorIlike, fromDate, limit, invoiceNumbers }
}

async function resolveVendor(params: {
  supabase: any
  vendorId: string | null
  vendorIlike: string
}): Promise<{ id: string; name: string }> {
  if (params.vendorId) {
    const { data, error } = await params.supabase
      .from('invoice_vendors')
      .select('id, name')
      .eq('id', params.vendorId)
      .maybeSingle()

    const row = assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load invoice_vendors id=${params.vendorId}`,
      error,
      data: (data ?? null) as { id?: unknown; name?: unknown } | null,
    })

    if (!row || typeof row.id !== 'string') {
      throw new Error(`[${SCRIPT_NAME}] Vendor not found for --vendor-id=${params.vendorId}`)
    }

    return { id: row.id, name: typeof row.name === 'string' ? row.name : '' }
  }

  const { data, error } = await params.supabase
    .from('invoice_vendors')
    .select('id, name')
    .ilike('name', params.vendorIlike)
    .limit(10)

  const vendors =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Find invoice_vendors ilike ${JSON.stringify(params.vendorIlike)}`,
      error,
      data: (data ?? null) as Array<{ id?: unknown; name?: unknown }> | null,
      allowMissing: true,
    }) ?? []

  if (vendors.length === 0) {
    throw new Error(
      `[${SCRIPT_NAME}] No vendors found for --vendor-ilike=${JSON.stringify(params.vendorIlike)}`
    )
  }

  const normalized = vendors
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : null,
      name: typeof row.name === 'string' ? row.name : '',
    }))
    .filter((row): row is { id: string; name: string } => typeof row.id === 'string')

  if (normalized.length !== 1) {
    console.log(`[${SCRIPT_NAME}] Multiple vendors matched:`)
    for (const row of normalized) {
      console.log(`- ${row.name} (${row.id})`)
    }
    throw new Error(`[${SCRIPT_NAME}] Vendor match is ambiguous; pass --vendor-id <uuid>`)
  }

  return normalized[0]
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] read-only starting`)
  console.log(`[${SCRIPT_NAME}] fromDate=${args.fromDate}`)
  console.log(`[${SCRIPT_NAME}] limit=${args.limit} (hard cap ${HARD_CAP_LIMIT})`)

  const vendor = await resolveVendor({ supabase, vendorId: args.vendorId, vendorIlike: args.vendorIlike })
  console.log(`[${SCRIPT_NAME}] Vendor: ${vendor.name} (${vendor.id})`)

  console.log(`\n[${SCRIPT_NAME}] Checking entries since ${args.fromDate}...`)
  const { count, error: countError } = await supabase
    .from('oj_entries')
    .select('id', { head: true, count: 'exact' })
    .eq('vendor_id', vendor.id)
    .gte('entry_date', args.fromDate)

  if (countError) {
    throw new Error(`[${SCRIPT_NAME}] Entry count failed: ${countError.message || 'unknown error'}`)
  }
  if (typeof count !== 'number') {
    throw new Error(`[${SCRIPT_NAME}] Entry count missing for vendor=${vendor.id}`)
  }

  const { data: entries, error: entryError } = await supabase
    .from('oj_entries')
    .select('entry_date, duration_minutes_rounded, status')
    .eq('vendor_id', vendor.id)
    .gte('entry_date', args.fromDate)
    .order('entry_date', { ascending: true })
    .limit(args.limit)

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load entries vendor=${vendor.id}`,
      error: entryError,
      data: (entries ?? null) as Array<{
        entry_date?: unknown
        duration_minutes_rounded?: unknown
        status?: unknown
      }> | null,
      allowMissing: true,
    }) ?? []

  const totalMinutes = entryRows.reduce((acc, row) => {
    const minutes = Number(row.duration_minutes_rounded ?? 0)
    return acc + (Number.isFinite(minutes) ? minutes : 0)
  }, 0)

  const sampleHours = totalMinutes / 60
  console.log(`[${SCRIPT_NAME}] Total entries (count): ${count}`)
  console.log(`[${SCRIPT_NAME}] Loaded entries: ${entryRows.length} (capped by --limit)`)

  if (count > args.limit) {
    console.log(
      `[${SCRIPT_NAME}] WARNING: results are capped; hour totals below reflect the first ${args.limit} entries only.`
    )
  }

  console.log(`[${SCRIPT_NAME}] Sample hours (from loaded rows): ${sampleHours.toFixed(2)} hours`)

  if (entryRows.length > 0) {
    const firstDate = entryRows[0].entry_date
    const lastDate = entryRows[entryRows.length - 1].entry_date
    console.log(`[${SCRIPT_NAME}] Sample entry_date range: ${String(firstDate ?? '')} to ${String(lastDate ?? '')}`)
  }

  if (args.invoiceNumbers.length === 0) {
    console.log(`\n[${SCRIPT_NAME}] No --invoice-number provided; skipping invoice lookups.`)
    return
  }

  console.log(`\n[${SCRIPT_NAME}] Checking invoices by invoice_number...`)
  console.log(`[${SCRIPT_NAME}] invoiceNumbers=${JSON.stringify(args.invoiceNumbers)}`)

  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, due_date, created_at')
    .in('invoice_number', args.invoiceNumbers)

  const invoiceRows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load invoices by invoice_number`,
      error: invoiceError,
      data: (invoices ?? null) as Array<{
        id?: unknown
        invoice_number?: unknown
        status?: unknown
        due_date?: unknown
        created_at?: unknown
      }> | null,
      allowMissing: true,
    }) ?? []

  const foundNumbers = new Set(
    invoiceRows
      .map((row) => (typeof row.invoice_number === 'string' ? row.invoice_number : null))
      .filter((value): value is string => typeof value === 'string')
  )

  const missing = args.invoiceNumbers.filter((invoiceNumber) => !foundNumbers.has(invoiceNumber))
  if (missing.length > 0) {
    throw new Error(`[${SCRIPT_NAME}] Missing invoices for invoice_number: ${missing.join(', ')}`)
  }

  console.log(`[${SCRIPT_NAME}] Found ${invoiceRows.length} invoice row(s).`)
  for (const invoice of invoiceRows) {
    console.log(
      `- ${String(invoice.invoice_number ?? '')}: status=${String(invoice.status ?? '')} due_date=${String(invoice.due_date ?? '')} created_at=${String(invoice.created_at ?? '')} id=${String(invoice.id ?? '')}`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

