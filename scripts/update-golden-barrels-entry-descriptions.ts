#!/usr/bin/env tsx

/**
 * Back up and update Golden Barrels OJ entry descriptions.
 *
 * Safety:
 * - Dry run by default and writes a verified JSON backup.
 * - Mutation requires --confirm, --backup-path, --limit 38, and two env gates.
 * - Matches every row by date, project, old description, duration/mileage, status,
 *   and invoice number before changing anything.
 * - Updates description only, then verifies billing fields are unchanged.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'update-golden-barrels-entry-descriptions'
const RUN_MUTATION_ENV = 'RUN_UPDATE_GOLDEN_BARRELS_DESCRIPTIONS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_UPDATE_GOLDEN_BARRELS_DESCRIPTIONS_MUTATION_SCRIPT'
const EXPECTED_ENTRY_COUNT = 38
const HARD_CAP = 38

type PlanRow = {
  date: string
  project: string
  oldDescription: string
  durationMinutes: number | null
  miles: number | null
  status: 'paid' | 'billed' | 'unbilled'
  invoiceNumber: string | null
  newDescription: string
}

const PLAN: PlanRow[] = [
  { date: '2025-12-03', project: 'Vision Workshop', oldDescription: 'Pre-workshop preparation', durationMinutes: 120, miles: null, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Vision workshop preparation' },
  { date: '2025-12-04', project: 'Vision Workshop', oldDescription: 'Travel from The Dukes Head', durationMinutes: 45, miles: null, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Travel time from the vision workshop' },
  { date: '2025-12-04', project: 'Vision Workshop', oldDescription: 'Workshop Facilitation', durationMinutes: 120, miles: null, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Vision workshop facilitation' },
  { date: '2025-12-04', project: 'Vision Workshop', oldDescription: 'Drive to and from The Dukes Head', durationMinutes: null, miles: 40, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Vision workshop return mileage, 40 miles' },
  { date: '2025-12-04', project: 'Vision Workshop', oldDescription: 'Travel to The Dukes Head', durationMinutes: 45, miles: null, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Travel time to the vision workshop' },
  { date: '2025-12-05', project: 'Vision Workshop', oldDescription: 'Playback & Write-up', durationMinutes: 120, miles: null, status: 'paid', invoiceNumber: 'INV-003VB', newDescription: 'The Dukes Head — Vision workshop playback and findings write-up' },
  { date: '2026-01-12', project: 'Website Build', oldDescription: 'Initial Setup & Scoping', durationMinutes: 120, miles: null, status: 'paid', invoiceNumber: null, newDescription: 'The Dukes Head website — Initial setup and project scoping' },
  { date: '2026-01-13', project: 'Website Build', oldDescription: 'Frontend Architecture & Layout', durationMinutes: 300, miles: null, status: 'paid', invoiceNumber: null, newDescription: 'The Dukes Head website — Front-end architecture and page layouts' },
  { date: '2026-01-14', project: 'Website Build', oldDescription: 'Component Development', durationMinutes: 218, miles: null, status: 'paid', invoiceNumber: 'INV-003VL', newDescription: 'The Dukes Head website — Component development, main session' },
  { date: '2026-01-14', project: 'Website Build', oldDescription: 'Component Development', durationMinutes: 22, miles: null, status: 'paid', invoiceNumber: null, newDescription: 'The Dukes Head website — Additional component development' },
  { date: '2026-01-15', project: 'Website Build', oldDescription: 'Core Features Implementation', durationMinutes: 285, miles: null, status: 'paid', invoiceNumber: 'INV-003VS', newDescription: 'The Dukes Head website — Core feature development, main session' },
  { date: '2026-01-15', project: 'Website Build', oldDescription: 'Core Features Implementation', durationMinutes: 75, miles: null, status: 'paid', invoiceNumber: 'INV-003VP', newDescription: 'The Dukes Head website — Additional core feature development' },
  { date: '2026-01-16', project: 'Website Build', oldDescription: 'Responsive Design & Fixes', durationMinutes: 180, miles: null, status: 'paid', invoiceNumber: 'INV-003VP', newDescription: 'The Dukes Head website — Responsive design and display fixes' },
  { date: '2026-01-17', project: 'Website Build', oldDescription: 'Content Integration & Polish', durationMinutes: 225, miles: null, status: 'paid', invoiceNumber: 'INV-003VW', newDescription: 'The Dukes Head website — Content integration and final styling' },
  { date: '2026-01-17', project: 'Website Build', oldDescription: 'Content Integration & Polish', durationMinutes: 15, miles: null, status: 'paid', invoiceNumber: 'INV-003VS', newDescription: 'The Dukes Head website — Additional content and styling updates' },
  { date: '2026-01-18', project: 'Website Build', oldDescription: 'Final Deployment & Launch Checks', durationMinutes: 60, miles: null, status: 'paid', invoiceNumber: 'INV-003VL', newDescription: 'The Dukes Head website — Deployment and launch checks' },
  { date: '2026-01-24', project: 'Website Build', oldDescription: 'Chased Mihiir for Fanzo details', durationMinutes: 30, miles: null, status: 'paid', invoiceNumber: 'INV-003VL', newDescription: 'The Dukes Head website — Fanzo information follow-up with Mihiir' },
  { date: '2026-01-30', project: 'Website Build', oldDescription: "Final changes made to website (social links, world cup, cricket world cup, women's football)", durationMinutes: 75, miles: null, status: 'paid', invoiceNumber: 'INV-003VW', newDescription: 'The Dukes Head website — Social links and football/cricket fixture updates' },
  { date: '2026-01-30', project: 'Website Build', oldDescription: 'Call to discuss final changes required.', durationMinutes: 45, miles: null, status: 'paid', invoiceNumber: 'INV-003VP', newDescription: 'The Dukes Head website — Final changes review call' },
  { date: '2026-01-30', project: 'Website Build', oldDescription: "Final changes made to website (social links, world cup, cricket world cup, women's football)", durationMinutes: 45, miles: null, status: 'paid', invoiceNumber: 'INV-003VZ', newDescription: 'The Dukes Head website — Additional social and sports content updates' },
  { date: '2026-05-22', project: 'General Work', oldDescription: 'Competitor analysis, website structure planning and design concepting for seaandseeds.co.uk', durationMinutes: 120, miles: null, status: 'paid', invoiceNumber: 'INV-003VZ', newDescription: 'Sea & Seeds website — Competitor research, site structure and design concepts' },
  { date: '2026-05-22', project: 'General Work', oldDescription: 'Turnstile integration and enhancements for opening times/CTA on all pages', durationMinutes: 60, miles: null, status: 'paid', invoiceNumber: 'INV-003VZ', newDescription: 'The Dukes Head website — Turnstile security, opening-time and booking CTA updates' },
  { date: '2026-05-22', project: 'General Work', oldDescription: 'Seaandseeds.co.uk Domain Purchase for 3 years', durationMinutes: null, miles: null, status: 'paid', invoiceNumber: 'INV-003VZ', newDescription: 'Sea & Seeds — Three-year seaandseeds.co.uk domain registration' },
  { date: '2026-05-26', project: 'General Work', oldDescription: 'Colour Pallet Call with Mihiir and Ankita', durationMinutes: 30, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds — Colour-palette review call with Mihiir and Ankita — possible duplicate' },
  { date: '2026-05-26', project: 'General Work', oldDescription: 'Colour Pallet Call with Mihiir and Ankita', durationMinutes: 30, miles: null, status: 'paid', invoiceNumber: 'INV-003VZ', newDescription: 'Sea & Seeds — Colour-palette review call with Mihiir and Ankita — possible duplicate' },
  { date: '2026-05-31', project: 'General Work', oldDescription: 'Main website build for seaandseeds.co.uk', durationMinutes: 90, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds website — Main launch-site build, initial session' },
  { date: '2026-05-31', project: 'General Work', oldDescription: 'Main website build for seaandseeds.co.uk', durationMinutes: 960, miles: null, status: 'unbilled', invoiceNumber: null, newDescription: 'Sea & Seeds website — Main launch-site build, extended development session' },
  { date: '2026-06-01', project: 'General Work', oldDescription: 'Driving to and from The Dukes Head for meeting with Mihiir', durationMinutes: 60, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds — Travel time to and from The Dukes Head for project meeting' },
  { date: '2026-06-01', project: 'General Work', oldDescription: 'Meeting with Mihiir', durationMinutes: 60, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds — Website progress meeting with Mihiir' },
  { date: '2026-06-01', project: 'General Work', oldDescription: 'Drive to and from The Dukes Head', durationMinutes: null, miles: 41.6, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds — Project meeting return mileage, 41.6 miles' },
  { date: '2026-06-23', project: 'General Work', oldDescription: 'SEO Optimisation', durationMinutes: 240, miles: null, status: 'billed', invoiceNumber: 'INV-003W9', newDescription: 'The Dukes Head website — SEO improvements and internal linking' },
  { date: '2026-06-26', project: 'General Work', oldDescription: 'Update seaandseeds sitewide for new July 3rd launch date', durationMinutes: 60, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds website — Sitewide launch-date update to 3 July' },
  { date: '2026-06-26', project: 'General Work', oldDescription: 'Pulling logos, reformatting and sharing with Mihiir', durationMinutes: 30, miles: null, status: 'billed', invoiceNumber: 'INV-003W5', newDescription: 'Sea & Seeds — Logo extraction, reformatting and delivery to Mihiir' },
  { date: '2026-07-16', project: 'General Work', oldDescription: 'Meeting to discuss progress/next steps for growth with Mihiir and Sakshi', durationMinutes: 60, miles: null, status: 'billed', invoiceNumber: 'INV-003W9', newDescription: 'Sea & Seeds — Post-launch progress and growth-planning meeting' },
  { date: '2026-07-18', project: 'General Work', oldDescription: 'Creation of the Google Business Profile for Sea and Seeds', durationMinutes: 120, miles: null, status: 'unbilled', invoiceNumber: null, newDescription: 'Sea & Seeds — Google Business Profile setup' },
  { date: '2026-07-18', project: 'General Work', oldDescription: 'Menu design for Dukes Head', durationMinutes: 120, miles: null, status: 'unbilled', invoiceNumber: null, newDescription: 'The Dukes Head — Food menu design' },
  { date: '2026-07-21', project: 'General Work', oldDescription: 'Food menu resizing/updates', durationMinutes: 30, miles: null, status: 'billed', invoiceNumber: 'INV-003W9', newDescription: 'The Dukes Head — Food menu artwork resizing and updates' },
  { date: '2026-07-24', project: 'General Work', oldDescription: 'Main menu changes for text size/styling, Fish and Chip price change and private hire panel addition', durationMinutes: 30, miles: null, status: 'billed', invoiceNumber: 'INV-003W9', newDescription: 'The Dukes Head — Main-menu styling, price update and private-hire panel' },
]

type Args = {
  confirm: boolean
  limit: number | null
  backupPath: string | null
}

function flagValue(argv: string[], flag: string): string | null {
  const exactIndex = argv.indexOf(flag)
  if (exactIndex >= 0) return argv[exactIndex + 1] || null
  const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`))
  return prefixed ? prefixed.slice(flag.length + 1) : null
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const rawLimit = flagValue(argv, '--limit')
  return {
    confirm: argv.includes('--confirm'),
    limit: rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : null,
    backupPath: flagValue(argv, '--backup-path'),
  }
}

function nullableNumberEqual(actual: unknown, expected: number | null): boolean {
  if (expected === null) return actual === null || actual === undefined
  return Number(actual) === expected
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function compareProtectedFields(before: Record<string, any>, after: Record<string, any>): string[] {
  const ignored = new Set(['description', 'updated_at'])
  return Object.keys(before)
    .filter((key) => !ignored.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  const args = parseArgs()
  const supabase = createAdminClient()

  assertScriptExpectedRowCount({ operation: 'Description plan', expected: EXPECTED_ENTRY_COUNT, actual: PLAN.length })

  const { data: vendorsRaw, error: vendorsError } = await supabase
    .from('invoice_vendors')
    .select('id, name')
    .ilike('name', '%Golden Barrels%')
    .limit(10)
  const vendors = assertScriptQuerySucceeded({
    operation: 'Find Golden Barrels vendor',
    error: vendorsError,
    data: vendorsRaw as Array<{ id: string; name: string }> | null,
  }) as Array<{ id: string; name: string }>
  assertScriptExpectedRowCount({ operation: 'Golden Barrels vendor match', expected: 1, actual: vendors.length })
  const vendor = vendors[0]

  const [entriesResult, projectsResult, invoicesResult] = await Promise.all([
    supabase.from('oj_entries').select('*').eq('vendor_id', vendor.id).order('entry_date').order('created_at'),
    supabase.from('oj_projects').select('id, project_name').eq('vendor_id', vendor.id),
    supabase.from('invoices').select('id, invoice_number').eq('vendor_id', vendor.id),
  ])
  const entries = assertScriptQuerySucceeded({ operation: 'Load Golden Barrels entries', error: entriesResult.error, data: entriesResult.data as any[] | null }) as any[]
  const projects = assertScriptQuerySucceeded({ operation: 'Load Golden Barrels projects', error: projectsResult.error, data: projectsResult.data as any[] | null }) as any[]
  const invoices = assertScriptQuerySucceeded({ operation: 'Load Golden Barrels invoices', error: invoicesResult.error, data: invoicesResult.data as any[] | null }) as any[]
  assertScriptExpectedRowCount({ operation: 'Golden Barrels entry scope', expected: EXPECTED_ENTRY_COUNT, actual: entries.length })

  const projectById = new Map(projects.map((row) => [row.id, row.project_name]))
  const invoiceById = new Map(invoices.map((row) => [row.id, row.invoice_number]))
  const usedIds = new Set<string>()
  const matches = PLAN.map((plan, index) => {
    const candidates = entries.filter((entry) =>
      !usedIds.has(entry.id) &&
      entry.entry_date === plan.date &&
      projectById.get(entry.project_id) === plan.project &&
      entry.description === plan.oldDescription &&
      nullableNumberEqual(entry.duration_minutes_rounded, plan.durationMinutes) &&
      nullableNumberEqual(entry.miles, plan.miles) &&
      entry.status === plan.status &&
      (invoiceById.get(entry.invoice_id) ?? null) === plan.invoiceNumber
    )
    assertScriptExpectedRowCount({ operation: `Match plan row ${index + 1}`, expected: 1, actual: candidates.length })
    usedIds.add(candidates[0].id)
    return { plan, entry: candidates[0] }
  })
  assertScriptExpectedRowCount({ operation: 'Unique matched entries', expected: EXPECTED_ENTRY_COUNT, actual: usedIds.size })

  const enrichedEntries = entries.map((entry) => ({
    ...entry,
    project_name: projectById.get(entry.project_id) ?? null,
    invoice_number: invoiceById.get(entry.invoice_id) ?? null,
  }))

  let backupPath: string
  if (args.confirm) {
    if (!args.backupPath) throw new Error(`[${SCRIPT_NAME}] mutation requires --backup-path`)
    backupPath = path.resolve(process.cwd(), args.backupPath)
    const backupText = await fs.readFile(backupPath, 'utf8')
    const backup = JSON.parse(backupText)
    assertScriptExpectedRowCount({ operation: 'Backup entry count', expected: EXPECTED_ENTRY_COUNT, actual: backup.entries?.length ?? 0 })
    if (backup.vendor?.id !== vendor.id) throw new Error(`[${SCRIPT_NAME}] backup vendor does not match live vendor`)
    if (JSON.stringify(backup.entries) !== JSON.stringify(enrichedEntries)) {
      throw new Error(`[${SCRIPT_NAME}] live entries changed after backup; refusing to update`)
    }
    console.log(`[${SCRIPT_NAME}] Verified existing backup: ${backupPath}`)
    console.log(`[${SCRIPT_NAME}] Backup SHA-256: ${sha256(backupText)}`)
  } else {
    const backupDir = path.resolve(process.cwd(), 'backups/golden-barrels')
    await fs.mkdir(backupDir, { recursive: true })
    backupPath = path.join(backupDir, `oj-entries-before-description-update-${safeTimestamp()}.json`)
    const backupText = `${JSON.stringify({
      schema_version: 1,
      snapshot_at: new Date().toISOString(),
      vendor,
      entry_count: enrichedEntries.length,
      entries: enrichedEntries,
    }, null, 2)}\n`
    await fs.writeFile(backupPath, backupText, { encoding: 'utf8', flag: 'wx' })
    const verifyText = await fs.readFile(backupPath, 'utf8')
    const verified = JSON.parse(verifyText)
    assertScriptExpectedRowCount({ operation: 'Written backup entry count', expected: EXPECTED_ENTRY_COUNT, actual: verified.entries?.length ?? 0 })
    if (JSON.stringify(verified.entries) !== JSON.stringify(enrichedEntries)) {
      throw new Error(`[${SCRIPT_NAME}] backup verification failed`)
    }
    console.log(`[${SCRIPT_NAME}] Verified backup written: ${backupPath}`)
    console.log(`[${SCRIPT_NAME}] Backup SHA-256: ${sha256(verifyText)}`)
  }

  console.log(`[${SCRIPT_NAME}] Matched ${matches.length} of ${entries.length} entries.`)
  for (const [index, match] of matches.entries()) {
    console.log(`${index + 1}. ${match.plan.date} | ${match.entry.id} | ${match.plan.oldDescription} -> ${match.plan.newDescription}`)
  }

  if (!args.confirm) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No database rows updated.`)
    console.log(`[${SCRIPT_NAME}] Use this verified backup for the confirmed run: ${path.relative(process.cwd(), backupPath)}`)
    return
  }

  if (args.limit !== EXPECTED_ENTRY_COUNT || args.limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit ${EXPECTED_ENTRY_COUNT}`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: RUN_MUTATION_ENV })
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  const updated: Array<{ id: string; description: string | null }> = []
  try {
    for (const match of matches) {
      const { data, error } = await supabase
        .from('oj_entries')
        .update({ description: match.plan.newDescription })
        .eq('id', match.entry.id)
        .eq('description', match.plan.oldDescription)
        .select('id, description')
      const result = assertScriptMutationSucceeded({
        operation: `Update oj_entries id=${match.entry.id}`,
        error,
        updatedRows: data as Array<{ id?: string }> | null,
      })
      assertScriptExpectedRowCount({ operation: `Update oj_entries id=${match.entry.id}`, expected: 1, actual: result.updatedCount })
      updated.push({ id: match.entry.id, description: match.entry.description })
    }
  } catch (error) {
    console.error(`[${SCRIPT_NAME}] Update failed; attempting rollback of ${updated.length} changed rows.`)
    for (const row of updated.reverse()) {
      const { error: rollbackError } = await supabase.from('oj_entries').update({ description: row.description }).eq('id', row.id)
      if (rollbackError) console.error(`[${SCRIPT_NAME}] Rollback failed for ${row.id}: ${rollbackError.message}`)
    }
    throw error
  }

  const ids = matches.map((match) => match.entry.id)
  const { data: afterRaw, error: afterError } = await supabase.from('oj_entries').select('*').in('id', ids)
  const after = assertScriptQuerySucceeded({ operation: 'Verify updated entries', error: afterError, data: afterRaw as any[] | null }) as any[]
  assertScriptExpectedRowCount({ operation: 'Updated entry verification count', expected: EXPECTED_ENTRY_COUNT, actual: after.length })
  const afterById = new Map(after.map((entry) => [entry.id, entry]))
  for (const match of matches) {
    const current = afterById.get(match.entry.id)
    if (!current || current.description !== match.plan.newDescription) {
      throw new Error(`[${SCRIPT_NAME}] description verification failed for ${match.entry.id}`)
    }
    const changedProtectedFields = compareProtectedFields(match.entry, current)
    if (changedProtectedFields.length > 0) {
      throw new Error(`[${SCRIPT_NAME}] protected fields changed for ${match.entry.id}: ${changedProtectedFields.join(', ')}`)
    }
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete and verified: ${after.length} descriptions updated.`)
  console.log(`[${SCRIPT_NAME}] Rollback source: ${backupPath}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
