#!/usr/bin/env tsx

import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import Papa from 'papaparse'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'import-till-sales-splits'
const RUN_MUTATION_ENV = 'RUN_IMPORT_TILL_SALES_SPLITS'
const ALLOW_MUTATION_ENV = 'ALLOW_IMPORT_TILL_SALES_SPLITS_SCRIPT'

type SalesRow = {
  sessionDate: string
  wet: number
  dry: number
  other: number
  total: number
}

type Args = {
  confirm: boolean
  file: string
  section: string
  startDate: string
  siteName: string | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      return argv[i + 1] ?? null
    }
    if (entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parseArgs(argv = process.argv): Args {
  const rest = argv.slice(2)
  const file = findFlagValue(rest, '--file')
  const section = findFlagValue(rest, '--section') ?? 'Net sales'
  const startDate = findFlagValue(rest, '--start-date') ?? '2019-03-01'
  const siteName = findFlagValue(rest, '--site-name')

  if (!file) {
    throw new Error(`[${SCRIPT_NAME}] --file is required`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`[${SCRIPT_NAME}] --start-date must be YYYY-MM-DD`)
  }

  return {
    confirm: rest.includes('--confirm'),
    file,
    section,
    startDate,
    siteName,
  }
}

function parseMoney(value: unknown): number {
  const text = String(value ?? '').replace(/[£,\s]/g, '')
  if (!text) return 0
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid currency value: ${String(value)}`)
  }
  return Number(parsed.toFixed(2))
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function labelForDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTH_LABELS[date.getUTCMonth()]}`
}

function dateFromStart(startDate: string, offset: number): Date {
  const date = new Date(`${startDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date
}

function extractSectionRows(csvRows: string[][], sectionName: string, startDate: string): SalesRow[] {
  const rows: SalesRow[] = []
  let active = false
  let offset = 0

  for (const row of csvRows) {
    const [label, wet, dry, other, total] = row
    if (!label) continue

    if (['Gross sales', 'Net sales', 'Total costs', 'Gross profit'].includes(label)) {
      active = label === sectionName
      offset = 0
      continue
    }
    if (!active) continue
    if (label === 'TOTAL') break

    const date = dateFromStart(startDate, offset)
    const expectedLabel = labelForDate(date)
    if (label !== expectedLabel) {
      throw new Error(
        `[${SCRIPT_NAME}] Date label mismatch at section row ${offset + 1}: expected ${expectedLabel}, found ${label}`
      )
    }

    rows.push({
      sessionDate: formatDate(date),
      wet: parseMoney(wet),
      dry: parseMoney(dry),
      other: parseMoney(other),
      total: parseMoney(total),
    })
    offset += 1
  }

  if (!rows.length) {
    throw new Error(`[${SCRIPT_NAME}] Section not found or empty: ${sectionName}`)
  }

  return rows
}

async function resolveSiteId(admin: ReturnType<typeof createAdminClient>, siteName: string | null) {
  let query = (admin.from('sites') as any).select('id, name').order('created_at', { ascending: true })
  if (siteName) {
    query = query.eq('name', siteName)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`[${SCRIPT_NAME}] Failed to load sites: ${error.message}`)
  }
  if (!data?.length) {
    throw new Error(`[${SCRIPT_NAME}] No site found${siteName ? ` named ${siteName}` : ''}`)
  }
  if (data.length > 1 && !siteName) {
    console.log(`[${SCRIPT_NAME}] Multiple sites found; using first site ${data[0].name} (${data[0].id})`)
  }
  return data[0] as { id: string; name: string }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs()
  const csvText = await fs.readFile(args.file, 'utf8')
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true })
  if (parsed.errors.length) {
    throw new Error(`[${SCRIPT_NAME}] CSV parse failed: ${parsed.errors[0].message}`)
  }

  const importedRows = extractSectionRows(parsed.data, args.section, args.startDate)
  const nonZeroRows = importedRows.filter((row) => row.total > 0)
  const admin = createAdminClient()
  const site = await resolveSiteId(admin, args.siteName)
  const fromDate = importedRows[0].sessionDate
  const toDate = importedRows[importedRows.length - 1].sessionDate

  const { data: existingImports, error: existingError } = await (admin.from('pnl_sales_imports') as any)
    .select('id, sale_date')
    .eq('site_id', site.id)
    .eq('source', 'till_csv')
    .eq('source_section', args.section)
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)

  if (existingError) {
    throw new Error(`[${SCRIPT_NAME}] Failed to load existing P&L sales imports: ${existingError.message}`)
  }

  const existingByDate = new Map<string, { id: string }>(
    (existingImports ?? []).map((row: any) => [row.sale_date, row])
  )

  const total = nonZeroRows.reduce((sum, row) => sum + row.total, 0)
  const wetTotal = nonZeroRows.reduce((sum, row) => sum + row.wet, 0)
  const dryTotal = nonZeroRows.reduce((sum, row) => sum + row.dry, 0)
  const otherTotal = nonZeroRows.reduce((sum, row) => sum + row.other, 0)

  console.log(`[${SCRIPT_NAME}] Section: ${args.section}`)
  console.log(`[${SCRIPT_NAME}] Site: ${site.name} (${site.id})`)
  console.log(`[${SCRIPT_NAME}] Date range: ${fromDate} to ${toDate}`)
  console.log(`[${SCRIPT_NAME}] Rows: ${importedRows.length}; non-zero rows: ${nonZeroRows.length}`)
  console.log(`[${SCRIPT_NAME}] Existing P&L import rows in range: ${existingByDate.size}`)
  console.log(`[${SCRIPT_NAME}] Will upsert P&L import rows: ${nonZeroRows.length}`)
  console.log(`[${SCRIPT_NAME}] Totals: WET £${wetTotal.toFixed(2)} DRY £${dryTotal.toFixed(2)} OTHER £${otherTotal.toFixed(2)} TOTAL £${total.toFixed(2)}`)

  if (!args.confirm) {
    console.log(`[${SCRIPT_NAME}] Dry run only. Re-run with --confirm and ${RUN_MUTATION_ENV}=true to import.`)
    return
  }

  if (process.env[RUN_MUTATION_ENV] !== 'true') {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked. Set ${RUN_MUTATION_ENV}=true`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  const now = new Date().toISOString()
  const importRows = nonZeroRows.map((row) => ({
    site_id: site.id,
    sale_date: row.sessionDate,
    source: 'till_csv',
    source_section: args.section,
    drinks_sales: row.wet,
    food_sales: row.dry,
    other_sales: row.other,
    total_sales: row.total,
    updated_at: now,
  }))

  if (importRows.length) {
    const { data, error } = await (admin.from('pnl_sales_imports') as any)
      .upsert(importRows, { onConflict: 'site_id,sale_date,source,source_section' })
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Upsert imported pnl_sales_imports',
      error,
      updatedRows: data,
      allowZeroRows: false,
    })
    assertScriptExpectedRowCount({
      operation: 'Upsert imported pnl_sales_imports',
      expected: importRows.length,
      actual: updatedCount,
    })
  }

  console.log(`[${SCRIPT_NAME}] Import complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
