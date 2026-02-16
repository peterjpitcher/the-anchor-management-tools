#!/usr/bin/env tsx
/**
 * Golden Barrels project diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Requires explicit `--vendor-id` targeting (no hard-coded production IDs).
 * - Caps output via `--limit` (hard cap 200).
 * - Fails closed on env/query errors.
 *
 * Usage:
 *   scripts/check-golden-barrels-projects.ts --vendor-id <uuid> [--limit 25]
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'check-golden-barrels-projects'
const DEFAULT_LIMIT = 25
const HARD_CAP_LIMIT = 200

type Args = {
  confirm: boolean
  vendorId: string
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

  const vendorId = readOptionalFlagValue(rest, '--vendor-id')
  if (!vendorId) {
    throw new Error(`[${SCRIPT_NAME}] Missing required --vendor-id <uuid>`)
  }

  const limitRaw = readOptionalFlagValue(rest, '--limit')
  const limit = parsePositiveInt(limitRaw) ?? DEFAULT_LIMIT
  if (limit > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_LIMIT})`)
  }

  return { confirm, vendorId, limit }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)
  console.log(`[${SCRIPT_NAME}] vendorId=${args.vendorId}`)
  console.log(`[${SCRIPT_NAME}] limit=${args.limit} (hard cap ${HARD_CAP_LIMIT})`)

  const { data, error } = await supabase
    .from('oj_projects')
    .select('id, project_name, project_code, status, created_at')
    .eq('vendor_id', args.vendorId)
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const projects =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load projects for vendor ${args.vendorId}`,
      error,
      data: (data ?? null) as Array<{
        id?: unknown
        project_name?: unknown
        project_code?: unknown
        status?: unknown
        created_at?: unknown
      }> | null,
      allowMissing: true,
    }) ?? []

  console.log(`[${SCRIPT_NAME}] Found ${projects.length} project(s).`)

  for (const project of projects) {
    console.log(
      `- [${String(project.status ?? '')}] ${String(project.project_name ?? '')} (code=${String(project.project_code ?? '')}, id=${String(project.id ?? '')}, created_at=${String(project.created_at ?? '')})`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

