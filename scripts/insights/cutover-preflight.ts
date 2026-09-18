#!/usr/bin/env tsx
/**
 * Cutover check for the Friday manager report (spec 8.2 and 8.3).
 *
 *   npx tsx scripts/insights/cutover-preflight.ts
 *
 * READ ONLY by design. It makes no insert, update, upsert, delete or RPC call, sends
 * nothing, and writes no file. It prints counts and record ids only, never names,
 * addresses, subjects or message content.
 *
 * Run it immediately before and immediately after the release and record the output in
 * the release notes. The last line is PASS or ATTENTION. ATTENTION means a frozen report
 * is still owed (or another listed problem) and the release should wait until it is
 * understood; see docs/manager-weekly-report.md.
 *
 * It reads through the service role in .env.local, like preview-report.ts. The recipient
 * settings it describes are the ones in .env.local on this machine, which can differ from
 * the values set in Vercel; check those in the Vercel dashboard.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { formatInTimeZone } from 'date-fns-tz'
import { fetchAllRows } from '../../src/lib/supabase/paged-read'
import { isValidEmailAddress } from '../../src/lib/notifications/channel'
import type { createAdminClient } from '../../src/lib/supabase/admin'

const ZONE = 'Europe/London'
/** Matches REPORT_HOUR_LONDON in src/lib/manager-report/schedule.ts. */
const REPORT_HOUR_LONDON = 6
const MAX_IDS_SHOWN = 100

/**
 * Only the report fields this check needs are selected, by JSON path, so no payload
 * (recipient, subject or body) is ever read. `sources` holds record ids only.
 */
interface ReportRow {
  id: string
  status: string | null
  format: string | null
  periodKey: string | null
  acceptedAt: string | null
  sources: unknown
}

interface IdRow { id: string }
interface OutboxRow { id: string; email_type: string | null; source_type: string | null }
interface LeaveReminderRow { request_id: string }

interface SourceRef {
  id?: unknown
  checklistOutboxId?: unknown
  communicationId?: unknown
  leaveRequestId?: unknown
}

export interface PreflightDependencies {
  db: ReturnType<typeof createAdminClient>
  now: Date
  env: Record<string, string | undefined>
  write: (line: string) => void
}

export interface PreflightResult {
  /** Empty means PASS. */
  attention: string[]
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1)
  return new Map([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function sources(row: ReportRow): SourceRef[] {
  return Array.isArray(row.sources) ? (row.sources as SourceRef[]) : []
}

function idList(refs: SourceRef[], key: keyof SourceRef): Set<string> {
  return new Set(refs.flatMap((ref) => (typeof ref[key] === 'string' ? [ref[key] as string] : [])))
}

/** Adds whole days to a yyyy-MM-dd date. Noon UTC keeps it clear of any clock change. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The Friday the next new report belongs to, as its London date (the report's periodKey).
 * Today when it is Friday before 06:00 London (today's report is not due yet), otherwise
 * the next Friday after today.
 */
function comingFriday(now: Date): string {
  const today = formatInTimeZone(now, ZONE, 'yyyy-MM-dd')
  const isoWeekday = Number(formatInTimeZone(now, ZONE, 'i'))
  const hour = Number(formatInTimeZone(now, ZONE, 'H'))
  if (isoWeekday === 5 && hour < REPORT_HOUR_LONDON) return today
  const daysAhead = ((5 - isoWeekday + 7) % 7) || 7
  return addDays(today, daysAhead)
}

function normalise(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

/** `system_settings.value` is jsonb; rota settings wrap it as `{ "value": "..." }`. */
function settingString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string') return inner.trim() || null
  }
  return null
}

export async function runCutoverPreflight({ db, now, env, write }: PreflightDependencies): Promise<PreflightResult> {
  const attention: string[] = []
  const print = (line = ''): void => write(line)
  const ids = (label: string, values: string[]): void => {
    if (values.length === 0) return
    const shown = values.slice(0, MAX_IDS_SHOWN)
    const suffix = values.length > shown.length ? ` (first ${shown.length} of ${values.length})` : ''
    print(`    ${label}${suffix}: ${shown.join(', ')}`)
  }
  const printCounts = (counts: Map<string, number>): void => {
    if (counts.size === 0) print('    none')
    for (const [label, count] of counts) print(`    ${label}: ${count}`)
  }

  print('Friday manager report: cutover preflight (read only)')
  print(`Run at ${formatInTimeZone(now, ZONE, "EEE d MMM yyyy HH:mm")} London`)
  print()

  // 1. Weekly reports, old format and new.
  const reports = await fetchAllRows<ReportRow>(
    (from, to) => db.from('email_messages')
      .select('id, status, format:metadata->>format, periodKey:metadata->>periodKey, acceptedAt:metadata->>acceptedAt, sources:metadata->sources')
      .eq('comm_type', 'manager_weekly_report')
      .order('id')
      .range(from, to),
    { label: 'manager_weekly_report rows' },
  )
  print(`1. Weekly reports (email_messages, comm_type manager_weekly_report): ${reports.length}`)
  print('  By status:')
  printCounts(countBy(reports, (row) => row.status ?? '(none)'))
  print('  By format:')
  printCounts(countBy(reports, (row) => row.format ?? 'old format (no format field)'))
  const notSent = reports.filter((row) => row.status !== 'sent')
  const unaccepted = notSent.filter((row) => !row.acceptedAt)
  const acceptedNotFinalised = notSent.filter((row) => Boolean(row.acceptedAt))
  print(`  Not 'sent': ${notSent.length}`)
  ids('ids', notSent.map((row) => row.id))
  print(`  Frozen and not yet accepted by the provider (still owed; delivery sends it first): ${unaccepted.length}`)
  ids('ids', unaccepted.map((row) => row.id))
  print(`  Accepted, sources not yet finalised (delivery finalises without resending): ${acceptedNotFinalised.length}`)
  ids('ids', acceptedNotFinalised.map((row) => row.id))
  if (unaccepted.length > 0) {
    attention.push(`${unaccepted.length} frozen weekly report(s) not yet accepted by the provider`)
  }
  print()

  // Anything an unfinished old-format report still owns will be finalised when it is delivered.
  const owed = notSent.flatMap(sources)
  const owedItems = idList(owed, 'id')
  const owedChecklist = idList(owed, 'checklistOutboxId')
  const owedCommunications = idList(owed, 'communicationId')
  const owedLeave = idList(owed, 'leaveRequestId')

  // 2. Old queued items.
  const items = await fetchAllRows<IdRow>(
    (from, to) => db.from('email_messages')
      .select('id')
      .eq('comm_type', 'manager_report_item')
      .eq('status', 'queued')
      .order('id')
      .range(from, to),
    { label: 'manager_report_item rows' },
  )
  const itemsOwned = items.filter((row) => owedItems.has(row.id))
  const itemsSuperseded = items.filter((row) => !owedItems.has(row.id))
  print(`2. Old queued report items (email_messages, manager_report_item, queued): ${items.length}`)
  print(`  In an unfinished frozen report (finalised when it is delivered): ${itemsOwned.length}`)
  ids('ids', itemsOwned.map((row) => row.id))
  print(`  Superseded by the insights report (left as is, nothing reads them): ${itemsSuperseded.length}`)
  ids('ids', itemsSuperseded.map((row) => row.id))
  print()

  // 3. Held checklist emails.
  const held = await fetchAllRows<OutboxRow>(
    (from, to) => db.from('checklist_email_outbox')
      .select('id, email_type, source_type')
      .eq('status', 'held')
      .order('id')
      .range(from, to),
    { label: 'held checklist_email_outbox rows' },
  )
  print(`3. Held checklist emails (checklist_email_outbox, held): ${held.length}`)
  print('  By type and source (held by the old report, or written while checklist emails were switched off):')
  printCounts(countBy(held, (row) => `${row.email_type ?? '(none)'} / ${row.source_type ?? '(none)'}`))
  const heldOwned = held.filter((row) => owedChecklist.has(row.id))
  const heldSuperseded = held.filter((row) => !owedChecklist.has(row.id))
  print(`  In an unfinished frozen report: ${heldOwned.length}`)
  ids('ids', heldOwned.map((row) => row.id))
  print(`  Not in any report (left as is): ${heldSuperseded.length}`)
  ids('ids', heldSuperseded.map((row) => row.id))
  print()

  // 4. Recruitment manager alerts. sendRecruitmentManagerAlert wrote them with
  //    type 'manager_alert' and delivery_status 'queued' until the report sent them.
  const alerts = await fetchAllRows<IdRow>(
    (from, to) => db.from('recruitment_communications')
      .select('id')
      .eq('type', 'manager_alert')
      .eq('delivery_status', 'queued')
      .order('id')
      .range(from, to),
    { label: 'queued recruitment manager alerts' },
  )
  const alertsOwned = alerts.filter((row) => owedCommunications.has(row.id))
  const alertsSuperseded = alerts.filter((row) => !owedCommunications.has(row.id))
  print(`4. Recruitment manager alerts still queued (recruitment_communications, manager_alert): ${alerts.length}`)
  print(`  In an unfinished frozen report: ${alertsOwned.length}`)
  ids('ids', alertsOwned.map((row) => row.id))
  print(`  Superseded (left as is, cannot be resent): ${alertsSuperseded.length}`)
  ids('ids', alertsSuperseded.map((row) => row.id))
  print()

  // 5. Pending leave with no reminder recorded.
  const pendingLeave = await fetchAllRows<IdRow>(
    (from, to) => db.from('leave_requests')
      .select('id')
      .eq('status', 'pending')
      .order('id')
      .range(from, to),
    { label: 'pending leave_requests' },
  )
  const reminded = new Set((await fetchAllRows<LeaveReminderRow>(
    (from, to) => db.from('leave_reminder_log')
      .select('request_id')
      .order('request_id')
      .order('reminder_kind')
      .range(from, to),
    { label: 'leave_reminder_log rows' },
  )).map((row) => row.request_id))
  const unreminded = pendingLeave.filter((row) => !reminded.has(row.id))
  const unremindedOwned = unreminded.filter((row) => owedLeave.has(row.id))
  print(`5. Pending leave requests: ${pendingLeave.length}; with no leave_reminder_log row: ${unreminded.length}`)
  print('  (No reminder email will be sent for these; each shows on the Insights page until decided.)')
  ids('ids', unreminded.map((row) => row.id))
  if (unremindedOwned.length > 0) {
    print(`  Of those, in an unfinished frozen report: ${unremindedOwned.length}`)
    ids('ids', unremindedOwned.map((row) => row.id))
  }
  print()

  // 6. A report already recorded for the coming Friday means no new report that day.
  const friday = comingFriday(now)
  const forFriday = reports.filter((row) => row.periodKey === friday)
  print(`6. Reports already recorded for the coming Friday (${friday}): ${forFriday.length}`)
  ids('ids', forFriday.map((row) => row.id))
  if (forFriday.length > 0) {
    attention.push(`a weekly report is already recorded for ${friday}, so no new report would be built that day`)
  }
  print()

  // 7. Recipient settings. Classified only; no address is printed.
  const manager = normalise(env.MANAGER_EMAIL)
  print('7. Recipient settings (from .env.local on this machine; Vercel may differ)')
  if (!manager) {
    print('    MANAGER_EMAIL: unset (the report falls back to its built-in default address)')
  } else if (!isValidEmailAddress(manager) || /[,;<>\s]/.test(manager)) {
    print('    MANAGER_EMAIL: set, but not one valid address (delivery would refuse to send)')
    attention.push('MANAGER_EMAIL in .env.local is not one valid address')
  } else {
    print('    MANAGER_EMAIL: set, one valid address')
  }
  const classify = (value: string | null | undefined): string => {
    const normalised = normalise(value)
    if (!normalised) return 'unset'
    return manager && normalised === manager ? 'same as MANAGER_EMAIL' : 'different'
  }
  for (const name of ['CHECKLIST_MANAGER_EMAIL', 'RECRUITMENT_NOTIFICATION_EMAIL', 'PRIVATE_BOOKINGS_MANAGER_EMAIL', 'ROTA_MANAGER_EMAIL']) {
    print(`    ${name}: ${classify(env[name])}`)
  }
  const { data: setting, error: settingError } = await db.from('system_settings')
    .select('value')
    .eq('key', 'rota_manager_email')
    .maybeSingle()
  if (settingError) {
    print('    system setting rota_manager_email: could not be read')
  } else {
    print(`    system setting rota_manager_email: ${classify(settingString(setting?.value))}`)
  }
  print('  (The weekly report goes to MANAGER_EMAIL only. The other settings no longer affect it.)')
  print()

  if (attention.length === 0) {
    print('PASS: no frozen report is owed and nothing blocks the next Friday report.')
  } else {
    print(`ATTENTION: ${attention.join('; ')}.`)
  }
  return { attention }
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  const { createAdminClient } = await import('../../src/lib/supabase/admin')
  await runCutoverPreflight({
    db: createAdminClient(),
    now: new Date(),
    env: process.env,
    write: (line) => process.stdout.write(`${line}\n`),
  })
}

// Runs only when invoked as a script, so a test can import runCutoverPreflight.
if (process.argv[1]?.endsWith('cutover-preflight.ts')) {
  main().catch((error: unknown) => {
    process.stderr.write(`Preflight failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.stderr.write('ATTENTION: the preflight could not complete, so nothing above can be relied on.\n')
    process.exitCode = 1
  })
}
