#!/usr/bin/env tsx
/**
 * Hiring candidate diagnostics (read-only).
 *
 * Default filter: candidates with placeholder first names like "Parsing CV...".
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Caps output via `--limit` (defaults to 25, hard cap 200).
 * - Masks PII in logs (email / parsed_data previews).
 * - Fails closed on env/query errors.
 *
 * Usage:
 *   scripts/debug-candidates.ts [--first-name-ilike "Parsing%"] [--limit 25]
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'debug-candidates'
const DEFAULT_FIRST_NAME_ILIKE = 'Parsing%'
const DEFAULT_LIMIT = 25
const HARD_CAP_LIMIT = 200

type Args = {
  confirm: boolean
  firstNameIlike: string
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

  const firstNameIlike = readOptionalFlagValue(rest, '--first-name-ilike') ?? DEFAULT_FIRST_NAME_ILIKE

  const limitRaw = readOptionalFlagValue(rest, '--limit')
  const limit = parsePositiveInt(limitRaw) ?? DEFAULT_LIMIT
  if (limit > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_LIMIT})`)
  }

  return { confirm, firstNameIlike, limit }
}

function maskEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '(missing)'
  const trimmed = value.trim()
  const at = trimmed.indexOf('@')
  if (at <= 1) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (domain.length === 0) return `${local.slice(0, 1)}***`
  return `${local.slice(0, 1)}***@${domain}`
}

function summarizeParsedData(value: unknown): string {
  if (!value) return '(missing)'
  if (typeof value !== 'object') return '(non-object)'
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 5)
  return `keys=${JSON.stringify(keys)}`
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] read-only starting`)
  console.log(`[${SCRIPT_NAME}] firstNameIlike=${JSON.stringify(args.firstNameIlike)}`)
  console.log(`[${SCRIPT_NAME}] limit=${args.limit} (hard cap ${HARD_CAP_LIMIT})`)

  const { data, error } = await supabase
    .from('hiring_candidates')
    .select('id, created_at, first_name, last_name, email, parsed_data')
    .ilike('first_name', args.firstNameIlike)
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load hiring_candidates`,
      error,
      data: (data ?? null) as Array<{
        id?: unknown
        created_at?: unknown
        first_name?: unknown
        last_name?: unknown
        email?: unknown
        parsed_data?: unknown
      }> | null,
      allowMissing: true,
    }) ?? []

  console.log(`[${SCRIPT_NAME}] Found ${rows.length} candidate(s).`)

  for (const row of rows) {
    console.log(
      `- id=${String(row.id ?? '')} created_at=${String(row.created_at ?? '')} name=${String(row.first_name ?? '')} ${String(row.last_name ?? '')} email=${maskEmail(row.email)} parsed_data=${summarizeParsedData(row.parsed_data)}`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

