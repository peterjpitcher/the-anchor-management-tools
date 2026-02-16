#!/usr/bin/env tsx
/**
 * Outstanding receipts diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Caps output via `--limit` (defaults to 50, hard cap 500).
 * - Fails closed on any query/RPC error.
 *
 * Usage:
 *   scripts/debug-outstanding.ts [--limit 50]
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'debug-outstanding'
const DEFAULT_LIMIT = 50
const HARD_CAP_LIMIT = 500

type Args = {
  confirm: boolean
  limit: number
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

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')

  const limitRaw = readOptionalFlagValue(rest, '--limit')
  const limit = parsePositiveInt(limitRaw) ?? DEFAULT_LIMIT
  if (limit > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_LIMIT})`)
  }

  return { confirm, limit }
}

function truncate(value: unknown, maxLen: number): string {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  if (raw.length <= maxLen) return raw
  return `${raw.slice(0, Math.max(0, maxLen - 3))}...`
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)
  console.log(`[${SCRIPT_NAME}] limit=${args.limit} (hard cap ${HARD_CAP_LIMIT})`)

  const { count, error: countError } = await supabase
    .from('receipt_transactions')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'pending')

  if (countError) {
    throw new Error(`[${SCRIPT_NAME}] Failed to count pending receipts: ${countError.message || 'unknown error'}`)
  }
  if (typeof count !== 'number') {
    throw new Error(`[${SCRIPT_NAME}] Missing pending receipt count`)
  }

  console.log(`[${SCRIPT_NAME}] Pending receipts (count): ${count}`)
  if (count > args.limit) {
    console.log(`[${SCRIPT_NAME}] WARNING: output capped by --limit; showing first ${args.limit} rows only.`)
  }

  const { data: receipts, error } = await supabase
    .from('receipt_transactions')
    .select('id, transaction_date, details, amount_in, amount_out, status')
    .eq('status', 'pending')
    .order('transaction_date', { ascending: true })
    .limit(args.limit)

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load pending receipts`,
      error,
      data: (receipts ?? null) as Array<{
        id?: unknown
        transaction_date?: unknown
        details?: unknown
        amount_in?: unknown
        amount_out?: unknown
        status?: unknown
      }> | null,
      allowMissing: true,
    }) ?? []

  console.log(`[${SCRIPT_NAME}] Loaded ${rows.length} pending receipt(s).`)
  for (const r of rows) {
    console.log(
      `- [${String(r.transaction_date ?? '')}] ${truncate(r.details, 80)} (in=${String(r.amount_in ?? '')}, out=${String(r.amount_out ?? '')}) id=${String(r.id ?? '')}`
    )
  }

  const { data: statusCounts, error: countRpcError } = await supabase.rpc('count_receipt_statuses')
  assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] RPC count_receipt_statuses`,
    error: countRpcError,
    data: (statusCounts ?? null) as unknown,
  })

  console.log(`[${SCRIPT_NAME}] RPC status counts:`, statusCounts)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
