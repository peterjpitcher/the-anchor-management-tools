#!/usr/bin/env tsx
/**
 * Move specific Barons Pubs entries into the "Website Content Creation" project.
 *
 * Safety:
 * - DRY RUN by default.
 * - Mutations require --confirm + env gates + explicit caps.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-move-to-website-content'
const RUN_MUTATION_ENV = 'RUN_OJ_MOVE_TO_WEBSITE_CONTENT_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_MOVE_TO_WEBSITE_CONTENT_MUTATION_SCRIPT'
const HARD_CAP = 500

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
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))

  return { confirm, dryRun, limit }
}

const RAW_DATA = `Thursday, September 25, 2025\tSeptember 2025\t5:00:00 PM\t9:00:00 PM\t4.00\t£250.00\t\tDemo Website Build
Friday, September 26, 2025\tSeptember 2025\t1:00:00 PM\t2:00:00 PM\t1.00\t£62.50\t\tWebsite Discussion with Ben and Georgia
Friday, September 26, 2025\tSeptember 2025\t3:00:00 PM\t4:00:00 PM\t1.00\t£62.50\t\tMarketing Scrum write up and website workshop planning
Thursday, November 6, 2025\tNovember 2025\t10:00:00 AM\t11:00:00 AM\t1.00\t£62.50\tConsulting\tWebsite Kickoff Planning
Monday, November 10, 2025\tNovember 2025\t3:00:00 PM\t3:30:00 PM\t0.50\t£31.25\tConsulting\tWebsite Kickoff Planning
Monday, December 1, 2025\tDecember 2025\t12:30:00 PM\t1:00:00 PM\t0.50\t£31.25\tConsulting\tDrive from Website Kickoff
Monday, December 1, 2025\tDecember 2025\t8:30:00 AM\t9:00:00 AM\t0.50\t£31.25\tConsulting\tDrive to Website Kickoff
Monday, December 1, 2025\tDecember 2025\t9:00:00 AM\t12:30:00 PM\t3.50\t£218.75\tConsulting\tWebsite Kickoff
Monday, December 1, 2025\tDecember 2025\t1:00:00 PM\t4:00:00 PM\t3.00\t£187.50\tConsulting\tWebsite Kickoff Write up & Follow up
Friday, December 12, 2025\tDecember 2025\t9:30:00 AM\t11:30:00 AM\t2.00\t£125.00\tConsulting\tWebsite Meeting with Natalie at Meade Hall
Thursday, January 15, 2026\tJanuary 2026\t12:30:00 PM\t1:30:00 PM\t1.00\t£62.50\tConsulting\tWrite up debrief from website call and marketing scrum
Friday, January 16, 2026\tJanuary 2026\t10:00:00 AM\t1:00:00 PM\t3.00\t£187.50\tConsulting\tWebsite Copy Validation Generation`

function parseDate(dateStr: string): string {
  const parts = dateStr.split(',')
  if (parts.length < 2) return new Date(dateStr).toISOString().slice(0, 10)

  let monthDay = ''
  let year = ''

  if (parts.length === 3) {
    monthDay = parts[1].trim()
    year = parts[2].trim()
  } else {
    monthDay = parts[0].trim()
    year = parts[1].trim()
  }

  const [monthName, day] = monthDay.split(' ')
  const months: Record<string, number> = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  }

  const m = months[monthName]
  if (m === undefined) return new Date(dateStr).toISOString().slice(0, 10)

  const y = Number.parseInt(year, 10)
  const d = Number.parseInt(day, 10)

  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function clean(str: string): string {
  if (!str) return ''
  return str.trim().replace(/^"|"$/g, '')
}

function norm(str: string): string {
  return str.toLowerCase().replace(/\s+/g, ' ').trim()
}

type EntryRow = {
  id: string
  entry_date: string
  description: string | null
  project_id: string | null
  project: { project_name: string | null } | null
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const { data: vendorRaw, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id')
    .eq('name', 'Barons Pubs')
    .maybeSingle()

  const vendor = assertScriptQuerySucceeded({
    operation: 'Load Barons Pubs vendor',
    error: vendorError,
    data: vendorRaw as { id: string } | null,
    allowMissing: false,
  }) as { id: string }

  const { data: projectRaw, error: projectError } = await supabase
    .from('oj_projects')
    .select('id, project_name')
    .eq('vendor_id', vendor.id)
    .ilike('project_name', '%Website Content Creation%')
    .maybeSingle()

  const project = assertScriptQuerySucceeded({
    operation: 'Load Website Content Creation project',
    error: projectError,
    data: projectRaw as { id: string; project_name: string } | null,
    allowMissing: false,
  }) as { id: string; project_name: string }

  console.log(`[${SCRIPT_NAME}] Target project: ${project.project_name} (${project.id})`)

  const { data: entriesRaw, error: entriesError } = await supabase
    .from('oj_entries')
    .select('id, entry_date, description, project_id, project:oj_projects(project_name)')
    .eq('vendor_id', vendor.id)

  const entries = assertScriptQuerySucceeded({
    operation: 'Load Barons Pubs entries',
    error: entriesError,
    data: entriesRaw as EntryRow[] | null,
    allowMissing: false,
  }) as EntryRow[]

  const lines = RAW_DATA.split('\n').filter((line) => line.trim().length > 0)

  const toMove: Array<{ id: string; dateIso: string; description: string; fromProject: string | null }> = []
  const alreadyInProject: Array<{ id: string; dateIso: string; description: string }> = []
  const notFound: Array<{ dateIso: string; description: string }> = []

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 8) {
      throw new Error(`[${SCRIPT_NAME}] malformed RAW_DATA line: ${line}`)
    }

    const dateRaw = clean(parts[0])
    const dateIso = parseDate(dateRaw)
    const description = clean(parts[7] || parts[parts.length - 1])

    const match = entries.find(
      (entry) => entry.entry_date === dateIso && norm(entry.description || '') === norm(description)
    )

    if (!match) {
      notFound.push({ dateIso, description })
      continue
    }

    if (match.project_id === project.id) {
      alreadyInProject.push({ id: match.id, dateIso, description })
      continue
    }

    toMove.push({
      id: match.id,
      dateIso,
      description,
      fromProject: match.project?.project_name ?? null,
    })
  }

  console.log(`[${SCRIPT_NAME}] Already in target project: ${alreadyInProject.length}`)
  console.log(`[${SCRIPT_NAME}] To move: ${toMove.length}`)
  console.log(`[${SCRIPT_NAME}] Not found: ${notFound.length}`)

  if (notFound.length > 0) {
    const preview = notFound.slice(0, 3).map((row) => `${row.dateIso} ${row.description}`).join(' | ')
    console.log(`[${SCRIPT_NAME}] NOT FOUND preview: ${preview}`)
  }

  const plannedOps = toMove.length

  if (plannedOps === 0) {
    if (notFound.length > 0) {
      throw new Error(`[${SCRIPT_NAME}] blocked: ${notFound.length} entries were not found`)
    }

    console.log(`[${SCRIPT_NAME}] Nothing to move.`)
    return
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) where n >= ${plannedOps}`)
    return
  }

  if (notFound.length > 0) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: ${notFound.length} entries were not found (refusing partial move)`)
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({
    scriptName: SCRIPT_NAME,
    envVar: ALLOW_MUTATION_ENV,
  })

  const limit = args.limit
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (plannedOps > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned mutations (${plannedOps}) exceeds --limit (${limit})`)
  }

  console.log(`[${SCRIPT_NAME}] Moving ${toMove.length} entries...`)

  for (const entry of toMove) {
    const { data, error } = await supabase
      .from('oj_entries')
      .update({ project_id: project.id })
      .eq('id', entry.id)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Move oj_entries id=${entry.id}`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Move oj_entries id=${entry.id}`,
      expected: 1,
      actual: updatedCount,
    })
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Moved ${toMove.length} entries.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
