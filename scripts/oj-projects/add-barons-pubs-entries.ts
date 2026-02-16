#!/usr/bin/env tsx
/**
 * Insert historical Barons Pubs OJ entries from embedded RAW_DATA.
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

const SCRIPT_NAME = 'oj-add-barons-pubs-entries'
const RUN_MUTATION_ENV = 'RUN_OJ_ADD_BARONS_PUBS_ENTRIES_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_ADD_BARONS_PUBS_ENTRIES_MUTATION_SCRIPT'
const HARD_CAP = 500

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3' // Barons Pubs
const PROJECT_ID = 'c7544454-de06-4913-9737-2dd127659a57' // Website Content Creation...

const WORK_TYPES = {
  CONSULTING: '1f6f85c3-2288-42fb-a866-b5393607445a', // Typo 'Consuluting'
  DEVELOPMENT: '42740cc9-761a-408a-b3a1-a6424695f4a6',
  TRAINING: 'c150c196-e331-46e6-94d9-8ade0953c4e3',
  TRANSIT: '55f8821f-d3b3-4550-a4fe-d0321bc59ef4',
} as const

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

const RAW_DATA = `
Thursday, September 4, 2025\tSeptember 2025\t11:30:00 AM\t12:30:00 PM\t1.00\t£62.50\t\tCall with Zonal
Wednesday, September 10, 2025\tSeptember 2025\t5:30:00 PM\t7:30:00 PM\t2.00\t£125.00\t\tMarketing Workshop Prep
Friday, September 12, 2025\tSeptember 2025\t9:00:00 AM\t9:30:00 AM\t0.50\t£31.25\t\tDriving to Marketing Workshop
Friday, September 12, 2025\tSeptember 2025\t1:30:00 PM\t2:00:00 PM\t0.50\t£31.25\t\tDriving from Marketing Workshop
Friday, September 12, 2025\tSeptember 2025\t9:30:00 AM\t12:30:00 PM\t3.00\t£187.50\t\tMarketing Workshop
Friday, September 12, 2025\tSeptember 2025\t12:30:00 PM\t1:30:00 PM\t1.00\t£62.50\t\tGeorgia Follow Up
Wednesday, September 17, 2025\tSeptember 2025\t9:30:00 AM\t10:00:00 AM\t0.50\t£31.25\t\tMeeting notes write up and follow up
Wednesday, September 17, 2025\tSeptember 2025\t4:00:00 PM\t5:30:00 PM\t1.50\t£93.75\t\tZonal loyalty call
Thursday, September 18, 2025\tSeptember 2025\t9:45:00 AM\t10:30:00 AM\t0.75\t£46.88\t\tCall with Andrew Hart discussing tech stack
Thursday, September 18, 2025\tSeptember 2025\t10:30:00 AM\t11:30:00 AM\t1.00\t£62.50\t\tWriting up tech stack and outstanding questions
Friday, September 19, 2025\tSeptember 2025\t9:00:00 AM\t9:30:00 AM\t0.50\t£31.25\t\tDriving to Marketing Scrum & Tech Stack Connect
Friday, September 19, 2025\tSeptember 2025\t1:00:00 PM\t1:30:00 PM\t0.50\t£31.25\t\tDriving from Marketing Scrum & Tech Stack Connect
Friday, September 19, 2025\tSeptember 2025\t9:30:00 AM\t1:00:00 PM\t3.50\t£218.75\t\tMarketing Scrum and Tech Stack Connect
Friday, September 19, 2025\tSeptember 2025\t2:00:00 PM\t4:00:00 PM\t2.00\t£125.00\t\tMarketing Scrum Write Up & Actions
Monday, September 22, 2025\tSeptember 2025\t3:00:00 PM\t4:00:00 PM\t1.00\t£62.50\t\tEvent Brief Development for Key Events
Thursday, September 25, 2025\tSeptember 2025\t10:30:00 AM\t11:15:00 AM\t0.75\t£46.88\t\tCall with Airship
Thursday, September 25, 2025\tSeptember 2025\t5:00:00 PM\t9:00:00 PM\t4.00\t£250.00\t\tDemo Website Build
Friday, September 26, 2025\tSeptember 2025\t10:00:00 AM\t1:00:00 PM\t3.00\t£187.50\t\tMarketing Scrum
Friday, September 26, 2025\tSeptember 2025\t9:30:00 AM\t10:00:00 AM\t0.50\t£31.25\t\tDrive to Marketing Scrum
Friday, September 26, 2025\tSeptember 2025\t1:00:00 PM\t2:00:00 PM\t1.00\t£62.50\t\tWebsite Discussion with Ben and Georgia
Friday, September 26, 2025\tSeptember 2025\t2:00:00 PM\t2:30:00 PM\t0.50\t£31.25\t\tDrive from Marketing Scrum
Friday, September 26, 2025\tSeptember 2025\t3:00:00 PM\t4:00:00 PM\t1.00\t£62.50\t\tMarketing Scrum write up and website workshop planning
Monday, September 29, 2025\tSeptember 2025\t11:00:00 AM\t12:30:00 PM\t1.50\t£93.75\t\tGuest Engagement Workshop Setup & Research
Thursday, October 9, 2025\tOctober 2025\t3:30:00 PM\t4:00:00 PM\t0.50\t£31.25\t\tGoogle Search Console follow up with Ben
Friday, October 10, 2025\tOctober 2025\t8:30:00 AM\t9:00:00 AM\t0.50\t£31.25\t\tDrive to Marketing Scrum
Friday, October 10, 2025\tOctober 2025\t9:00:00 AM\t11:00:00 AM\t2.00\t£125.00\t\tMarketing Scrum & Event Actioning
Friday, October 10, 2025\tOctober 2025\t11:00:00 AM\t11:30:00 AM\t0.50\t£31.25\t\tDrive from Marketing Scrum
Tuesday, October 14, 2025\tOctober 2025\t5:00:00 PM\t10:00:00 PM\t5.00\t£312.50\t\tPrep for Workshop (consolidation of feedback)
Tuesday, October 14, 2025\tOctober 2025\t5:00:00 AM\t11:00:00 AM\t6.00\t£375.00\t\tBarons Events Application Demo Build
Thursday, October 16, 2025\tOctober 2025\t8:30:00 AM\t9:00:00 AM\t0.50\t£31.25\t\tDrive to The Star, Guest Engagement Workshop
Thursday, October 16, 2025\tOctober 2025\t9:00:00 AM\t12:00:00 PM\t3.00\t£187.50\t\tGuest Engagement Workshop
Thursday, October 16, 2025\tOctober 2025\t12:00:00 PM\t12:30:00 PM\t0.50\t£31.25\t\tDrive back from The Star, Guest Engagement Workshop
Thursday, October 16, 2025\tOctober 2025\t2:00:00 PM\t6:00:00 PM\t4.00\t£250.00\t\tWrite up from Guest Engagement Workshop
Friday, October 17, 2025\tOctober 2025\t8:00:00 AM\t2:00:00 PM\t6.00\t£375.00\t\tBarons Events Application Demo Build
Sunday, October 19, 2025\tOctober 2025\t5:00:00 PM\t9:00:00 PM\t4.00\t£250.00\t\tBarons Events Application Demo Build
Monday, October 20, 2025\tOctober 2025\t7:00:00 AM\t11:30:00 AM\t4.50\t£281.25\t\tBarons Events Application Demo Build
Thursday, November 6, 2025\tNovember 2025\t10:00:00 AM\t11:00:00 AM\t1.00\t£62.50\tConsulting\tWebsite Kickoff Planning
Monday, November 10, 2025\tNovember 2025\t3:00:00 PM\t3:30:00 PM\t0.50\t£31.25\tConsulting\tWebsite Kickoff Planning
Monday, December 1, 2025\tDecember 2025\t12:30:00 PM\t1:00:00 PM\t0.50\t£31.25\tConsulting\tDrive from Website Kickoff
Monday, December 1, 2025\tDecember 2025\t8:30:00 AM\t9:00:00 AM\t0.50\t£31.25\tConsulting\tDrive to Website Kickoff
Monday, December 1, 2025\tDecember 2025\t9:00:00 AM\t12:30:00 PM\t3.50\t£218.75\tConsulting\tWebsite Kickoff
Monday, December 1, 2025\tDecember 2025\t1:00:00 PM\t4:00:00 PM\t3.00\t£187.50\tConsulting\tWebsite Kickoff Write up & Follow up
Tuesday, December 2, 2025\tDecember 2025\t8:00:00 PM\t9:00:00 PM\t1.00\t£62.50\tConsulting\tPhotography Session Planning & Prep
Wednesday, December 3, 2025\tDecember 2025\t12:00:00 PM\t1:30:00 PM\t1.50\t£93.75\tConsulting\tCareerHub Requirements Development
Tuesday, December 9, 2025\tDecember 2025\t3:00:00 PM\t3:30:00 PM\t0.50\t£31.25\tConsulting\tOrganising Connect Dates
Thursday, December 11, 2025\tDecember 2025\t1:00:00 PM\t1:30:00 PM\t0.50\t£31.25\tConsulting\tDrive from The Cricketers
Thursday, December 11, 2025\tDecember 2025\t9:30:00 AM\t10:00:00 AM\t0.50\t£31.25\tConsulting\tDrive to The Cricketers
Thursday, December 11, 2025\tDecember 2025\t10:00:00 AM\t1:00:00 PM\t3.00\t£187.50\tConsulting\tMarketing Scrum & Brand Guidelines Review with Georgia
Friday, December 12, 2025\tDecember 2025\t11:30:00 AM\t12:00:00 PM\t0.50\t£31.25\tConsulting\tDrive from Meade Hall
Friday, December 12, 2025\tDecember 2025\t9:00:00 AM\t9:30:00 AM\t0.50\t£31.25\tConsulting\tDrive to Meade Hall
Friday, December 12, 2025\tDecember 2025\t9:30:00 AM\t11:30:00 AM\t2.00\t£125.00\tConsulting\tWebsite Meeting with Natalie at Meade Hall
Monday, December 15, 2025\tDecember 2025\t10:30:00 AM\t6:00:00 PM\t7.50\t£468.75\tDevelopment\tCareerHub Build
Monday, December 15, 2025\tDecember 2025\t9:30:00 AM\t10:30:00 AM\t1.00\t£62.50\tConsulting\tCareerHub Call with Helene/Kate
Tuesday, December 16, 2025\tDecember 2025\t5:30:00 PM\t9:00:00 PM\t3.50\t£218.75\tDevelopment\tCareerHub Build
Wednesday, December 17, 2025\tDecember 2025\t6:00:00 AM\t11:30:00 AM\t5.50\t£343.75\tDevelopment\tCareerHub Build
Friday, January 2, 2026\tJanuary 2026\t4:30:00 PM\t5:00:00 PM\t0.50\t£31.25\tDevelopment\tAdding delete and cost tracking functionality to EventHub
Monday, January 5, 2026\tJanuary 2026\t7:00:00 AM\t9:00:00 AM\t2.00\t£125.00\tConsulting\tMarketing SCRUM Prep
Monday, January 5, 2026\tJanuary 2026\t1:30:00 PM\t2:00:00 PM\t0.50\t£31.25\tConsulting\tDrive to The Cricketers
Monday, January 5, 2026\tJanuary 2026\t2:00:00 PM\t4:00:00 PM\t2.00\t£125.00\tConsulting\tWeekly Marketing SCRUM
Monday, January 5, 2026\tJanuary 2026\t4:00:00 PM\t4:30:00 PM\t0.50\t£31.25\tConsulting\tDrive from The Cricketers
Wednesday, January 7, 2026\tJanuary 2026\t2:00:00 PM\t2:30:00 PM\t0.50\t£31.25\tConsuling\tFavourite Table Media engagement
Wednesday, January 7, 2026\tJanuary 2026\t2:30:00 PM\t3:30:00 PM\t1.00\t£62.50\tDevelopment\tFixing delete error and form validation in EventHub
Monday, January 12, 2026\tJanuary 2026\t9:00:00 AM\t9:30:00 AM\t0.50\t£31.25\tConsulting\tPhone connect with Helen. Favourite Table media options.
Monday, January 12, 2026\tJanuary 2026\t9:30:00 AM\t10:30:00 AM\t1.00\t£62.50\tConsulting\tCall with Helen to discuss open work
Monday, January 12, 2026\tJanuary 2026\t10:30:00 AM\t12:00:00 PM\t1.50\t£93.75\tConsulting\tFavouriteTable media options email chain/discussion / table booking media strategy development
Wednesday, January 14, 2026\tJanuary 2026\t7:00:00 AM\t9:00:00 AM\t2.00\t£125.00\tConsulting\tMarketing SCRUM Prep
Thursday, January 15, 2026\tJanuary 2026\t12:30:00 PM\t1:30:00 PM\t1.00\t£62.50\tConsulting\tWrite up debrief from website call and marketing scrum
Thursday, January 15, 2026\tJanuary 2026\t9:00:00 AM\t9:30:00 AM\t0.50\t£31.25\tConsulting\tDrive to Marketing scrum
Thursday, January 15, 2026\tJanuary 2026\t12:00:00 PM\t12:30:00 PM\t0.50\t£31.25\tConsulting\tDrive from Marketing scrum
Thursday, January 15, 2026\tJanuary 2026\t9:30:00 AM\t12:00:00 PM\t2.50\t£156.25\tConsulting\tMarketing Scrum
Friday, January 16, 2026\tJanuary 2026\t10:00:00 AM\t1:00:00 PM\t3.00\t£187.50\tConsulting\tWebsite Copy Validation Generation
Monday, January 19, 2026\tJanuary 2026\t7:00:00 AM\t9:00:00 AM\t2.00\t£125.00\tConsulting\tMarketing SCRUM Prep
`

function getWorkTypeId(category: string, description: string): string {
  const cleanCat = (category || '').trim().toLowerCase()
  const cleanDesc = (description || '').trim().toLowerCase()

  if (cleanCat.includes('development')) return WORK_TYPES.DEVELOPMENT
  if (cleanCat.includes('training')) return WORK_TYPES.TRAINING

  if (cleanDesc.includes('drive to') || cleanDesc.includes('drive from') || cleanDesc.includes('driving')) {
    return WORK_TYPES.TRANSIT
  }

  if (cleanDesc.includes('build') || cleanDesc.includes('code') || cleanDesc.includes('develop')) {
    return WORK_TYPES.DEVELOPMENT
  }

  return WORK_TYPES.CONSULTING
}

function parseDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr} ${timeStr}`)
}

function getStatus(date: Date) {
  const cutoff = new Date('2025-12-31T23:59:59')
  if (date <= cutoff) {
    return { status: 'paid', paid_at: date.toISOString() }
  }
  return { status: 'unbilled', paid_at: null }
}

type PlannedEntry = {
  vendor_id: string
  project_id: string
  entry_type: 'time'
  entry_date: string
  start_at: string
  end_at: string
  duration_minutes_raw: number
  duration_minutes_rounded: number
  work_type_id: string
  description: string
  status: string
  paid_at: string | null
  billable: boolean
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)
  console.log(`[${SCRIPT_NAME}] vendor_id=${VENDOR_ID} project_id=${PROJECT_ID}`)

  const lines = RAW_DATA.trim().split('\n').filter(Boolean)
  const planned: PlannedEntry[] = []

  for (const line of lines) {
    const parts = line.split(/\t| {2,}/)
    if (parts.length < 8) {
      throw new Error(`[${SCRIPT_NAME}] malformed RAW_DATA line: ${line}`)
    }

    const [dateStr, _monthStr, startTimeStr, endTimeStr, hoursStr, _costStr, categoryStr, reasonStr] = parts

    const startAt = parseDate(dateStr, startTimeStr)
    const endAt = parseDate(dateStr, endTimeStr)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      throw new Error(`[${SCRIPT_NAME}] invalid date/time in line: ${line}`)
    }

    const hours = Number.parseFloat(hoursStr)
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error(`[${SCRIPT_NAME}] invalid hours value (${hoursStr}) in line: ${line}`)
    }

    const minutes = Math.round(hours * 60)
    const workTypeId = getWorkTypeId(categoryStr, reasonStr)
    const { status, paid_at } = getStatus(startAt)
    const entryDate = startAt.toISOString().split('T')[0]

    planned.push({
      vendor_id: VENDOR_ID,
      project_id: PROJECT_ID,
      entry_type: 'time',
      entry_date: entryDate,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      duration_minutes_raw: minutes,
      duration_minutes_rounded: minutes,
      work_type_id: workTypeId,
      description: reasonStr,
      status,
      paid_at,
      billable: true,
    })
  }

  console.log(`[${SCRIPT_NAME}] Prepared entries: ${planned.length}`)

  // Dedupe guard: block re-runs that would insert duplicates.
  const duplicates: Array<{ entry_date: string; description: string }> = []
  for (const entry of planned) {
    const { data, error } = await supabase
      .from('oj_entries')
      .select('id')
      .eq('vendor_id', entry.vendor_id)
      .eq('project_id', entry.project_id)
      .eq('entry_type', entry.entry_type)
      .eq('entry_date', entry.entry_date)
      .eq('description', entry.description)
      .maybeSingle()

    const existing = assertScriptQuerySucceeded({
      operation: 'Check for existing entry duplicate',
      error,
      data: data as { id: string } | null,
      allowMissing: true,
    })

    if (existing) {
      duplicates.push({ entry_date: entry.entry_date, description: entry.description })
    }
  }

  if (duplicates.length > 0) {
    const preview = duplicates.slice(0, 3).map((row) => `${row.entry_date} ${row.description}`).join(' | ')
    throw new Error(`[${SCRIPT_NAME}] blocked: detected existing entry duplicates: ${preview}`)
  }

  const plannedOps = planned.length

  if (plannedOps === 0) {
    console.log(`[${SCRIPT_NAME}] Nothing to insert.`)
    return
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows inserted.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) where n >= ${plannedOps}`)
    return
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
    throw new Error(`[${SCRIPT_NAME}] planned inserts (${plannedOps}) exceeds --limit (${limit})`)
  }

  const { data, error } = await supabase.from('oj_entries').insert(planned).select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Insert oj_entries rows',
    error,
    updatedRows: data as Array<{ id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: 'Insert oj_entries rows',
    expected: planned.length,
    actual: updatedCount,
  })

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Inserted ${updatedCount} entry row(s).`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
