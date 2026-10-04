/**
 * The owner's daily summary of the invoice reminder job, and the record each run leaves behind.
 *
 * PURE: no database, no clock, no environment. The job gathers what happened and passes it in;
 * this module only decides what is worth saying and how to say it, in plain text.
 *
 * One summary replaces the alert per reminder the old job sent: 75 of those went out, and the
 * few that needed action looked the same as the rest. So every section appears only when it
 * has something in it, "Needs you" does not repeat itself daily, and nothing at all is sent on
 * a day with nothing to say. See tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R2).
 */

import { getIsoWeekday } from '@/lib/dateUtils'
import { formatInvoiceDate } from './email-copy'
import { nextRunDate, type ReminderStage } from './reminder-rules'

export interface SummarySentEntry {
  invoiceNumber: string
  clientName: string
  /** The To address of the reminder. The only customer address a summary ever carries. */
  to: string
  stage: ReminderStage
  /** London date of the run that sent it. */
  date: string
}

export interface SummaryProblemEntry {
  invoiceNumber: string | null
  clientName: string | null
  message: string
  /** Link to the invoice, when the problem is about one. */
  url: string | null
  /** London date of the run it happened on. */
  date: string
}

export interface SummaryGoingNextEntry {
  invoiceNumber: string
  clientName: string
  stage: ReminderStage
  /** Link to the invoice, so the reminder can be held before it goes. */
  url: string
}

export interface SummaryNeedsYouEntry {
  invoiceId: string
  /** Why it needs the owner. With the invoice id, this is the entry's identity between runs. */
  reason: string
  invoiceNumber: string
  clientName: string
  detail: string
  url: string
}

/**
 * Whether a run's summary reached the owner.
 *  - pending:    the run had not got as far as sending it (it died first)
 *  - accepted:   sent
 *  - failed:     tried and refused
 *  - not_needed: there was nothing to say
 */
export type SummaryDelivery = 'pending' | 'accepted' | 'failed' | 'not_needed'

/**
 * What a run saves on its `cron_job_runs` row. The next run reads it to decide whether "Needs
 * you" has changed and whether an undelivered summary has to be carried forward. It is also
 * where the results can still be read when email is suspended or the summary cannot be sent.
 */
export interface ReminderRunState {
  v: 1
  sent: SummarySentEntry[]
  problems: SummaryProblemEntry[]
  needs_you_keys: string[]
  summary: SummaryDelivery
  /** Why the run, or its summary, failed. */
  error?: string
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function isStage(value: unknown): value is ReminderStage {
  return value === 'first' || value === 'second'
}

function isDelivery(value: unknown): value is SummaryDelivery {
  return value === 'pending' || value === 'accepted' || value === 'failed' || value === 'not_needed'
}

/**
 * Reads a saved run record. Returns null for anything that is not one: an empty column, the
 * plain error text another job would write, or a record from a future version. Entries that
 * are missing a field are dropped one by one, so a damaged record can never put "undefined"
 * into the owner's summary.
 */
export function parseRunState(raw: string | null | undefined): ReminderRunState | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.v !== 1 || !isDelivery(record.summary)) return null

  const sent: SummarySentEntry[] = []
  for (const item of Array.isArray(record.sent) ? record.sent : []) {
    const entry = (item ?? {}) as Record<string, unknown>
    const invoiceNumber = asText(entry.invoiceNumber)
    const clientName = asText(entry.clientName)
    const to = asText(entry.to)
    const date = asText(entry.date)
    if (invoiceNumber && clientName && to && date && isStage(entry.stage)) {
      sent.push({ invoiceNumber, clientName, to, stage: entry.stage, date })
    }
  }

  const problems: SummaryProblemEntry[] = []
  for (const item of Array.isArray(record.problems) ? record.problems : []) {
    const entry = (item ?? {}) as Record<string, unknown>
    const message = asText(entry.message)
    const date = asText(entry.date)
    if (message && date) {
      problems.push({
        invoiceNumber: asText(entry.invoiceNumber),
        clientName: asText(entry.clientName),
        message,
        url: asText(entry.url),
        date,
      })
    }
  }

  const needsYouKeys = (Array.isArray(record.needs_you_keys) ? record.needs_you_keys : []).filter(
    (key): key is string => typeof key === 'string'
  )

  return {
    v: 1,
    sent,
    problems,
    needs_you_keys: needsYouKeys,
    summary: record.summary,
    ...(asText(record.error) ? { error: asText(record.error) as string } : {}),
  }
}

export function serialiseRunState(state: ReminderRunState): string {
  return JSON.stringify(state)
}

function needsYouKey(entry: Pick<SummaryNeedsYouEntry, 'invoiceId' | 'reason'>): string {
  return `${entry.invoiceId}:${entry.reason}`
}

/** The identity of a "Needs you" list: sorted, with no repeats, so two lists compare cleanly. */
export function needsYouKeys(entries: Array<Pick<SummaryNeedsYouEntry, 'invoiceId' | 'reason'>>): string[] {
  return [...new Set(entries.map(needsYouKey))].sort()
}

function sameKeys(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/**
 * "Needs you" is shown on Mondays, and on any other day its entries differ from the list the
 * owner last saw. `previousKeys` is null when there is no earlier list on record, which counts
 * as different: when in doubt, tell him.
 */
export function shouldShowNeedsYou(today: string, keys: string[], previousKeys: string[] | null): boolean {
  if (keys.length === 0) return false
  if (getIsoWeekday(today) === 1) return true
  if (previousKeys === null) return true
  return !sameKeys(keys, previousKeys)
}

export interface ReminderSummaryInput {
  /** London calendar date of the run. */
  today: string
  /** False while `INVOICE_REMINDERS_GO_LIVE_DATE` is unset. */
  remindersOn: boolean
  sent: SummarySentEntry[]
  goingNext: SummaryGoingNextEntry[]
  needsYou: SummaryNeedsYouEntry[]
  problems: SummaryProblemEntry[]
  /** The "Needs you" keys the owner last saw, or null when there is none on record. */
  previousNeedsYouKeys: string[] | null
  /** What an earlier run sent and hit, when its own summary never reached the owner. */
  carriedOver?: { sent: SummarySentEntry[]; problems: SummaryProblemEntry[] } | null
}

interface ReminderSummary {
  subject: string
  text: string
}

function stageLabel(stage: ReminderStage): string {
  return stage === 'first' ? 'first reminder' : 'second reminder'
}

function invoiceLabel(invoiceNumber: string | null, clientName: string | null): string {
  return [invoiceNumber, clientName].filter((part): part is string => Boolean(part && part.trim())).join(', ')
}

function sentLine(entry: SummarySentEntry): string {
  return `${invoiceLabel(entry.invoiceNumber, entry.clientName)}: ${stageLabel(entry.stage)} to ${entry.to}`
}

function problemLine(entry: SummaryProblemEntry): string {
  const label = invoiceLabel(entry.invoiceNumber, entry.clientName)
  return label ? `${label}: ${entry.message}` : entry.message
}

/** A problem is listed once, however many code paths reported it. */
function dedupeProblems(entries: SummaryProblemEntry[]): SummaryProblemEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.date}|${entry.invoiceNumber ?? ''}|${entry.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function count(total: number, singular: string, plural: string): string {
  return `${total} ${total === 1 ? singular : plural}`
}

/**
 * The summary email, or null when there is nothing to say. Null means send nothing: an empty
 * daily email is exactly the noise this replaces.
 */
export function buildReminderSummary(input: ReminderSummaryInput): ReminderSummary | null {
  const problems = dedupeProblems(input.problems)
  const carriedSent = input.carriedOver?.sent ?? []
  const carriedProblems = dedupeProblems(input.carriedOver?.problems ?? [])
  const showNeedsYou = shouldShowNeedsYou(input.today, needsYouKeys(input.needsYou), input.previousNeedsYouKeys)

  const sections: string[][] = []

  if (input.sent.length > 0) {
    sections.push(['Sent today', ...input.sent.map((entry) => `- ${sentLine(entry)}`)])
  }

  if (input.goingNext.length > 0) {
    sections.push([
      'Going next',
      `A forecast for ${formatInvoiceDate(nextRunDate(input.today))}, not a promise: everything is checked again before anything is sent. Open the invoice to hold a reminder.`,
      ...input.goingNext.flatMap((entry) => [
        `- ${invoiceLabel(entry.invoiceNumber, entry.clientName)}: ${stageLabel(entry.stage)}`,
        `  ${entry.url}`,
      ]),
    ])
  }

  if (showNeedsYou) {
    sections.push([
      'Needs you',
      ...input.needsYou.flatMap((entry) => [
        `- ${invoiceLabel(entry.invoiceNumber, entry.clientName)}: ${entry.detail}`,
        `  ${entry.url}`,
      ]),
    ])
  }

  if (problems.length > 0) {
    sections.push([
      'Problems',
      ...problems.flatMap((entry) => [`- ${problemLine(entry)}`, ...(entry.url ? [`  ${entry.url}`] : [])]),
    ])
  }

  if (carriedSent.length > 0 || carriedProblems.length > 0) {
    sections.push([
      'Not reported before',
      'An earlier summary could not be sent, so this is what it would have said.',
      ...(carriedSent.length > 0
        ? ['Sent:', ...carriedSent.map((entry) => `- ${formatInvoiceDate(entry.date)}: ${sentLine(entry)}`)]
        : []),
      ...(carriedProblems.length > 0
        ? [
            'Problems:',
            ...carriedProblems.flatMap((entry) => [
              `- ${formatInvoiceDate(entry.date)}: ${problemLine(entry)}`,
              ...(entry.url ? [`  ${entry.url}`] : []),
            ]),
          ]
        : []),
    ])
  }

  if (sections.length === 0) return null

  const heading = [`Invoice reminders for ${formatInvoiceDate(input.today, { withYear: true })}`]
  if (!input.remindersOn) {
    heading.push('Automatic reminders are switched off, so no customer was emailed. Chase from the invoice page.')
  }

  const counts = [
    input.sent.length > 0 ? `${input.sent.length} sent` : null,
    input.goingNext.length > 0 ? `${input.goingNext.length} going next` : null,
    showNeedsYou ? count(input.needsYou.length, 'needs you', 'need you') : null,
    problems.length > 0 ? count(problems.length, 'problem', 'problems') : null,
    carriedSent.length + carriedProblems.length > 0
      ? `${carriedSent.length + carriedProblems.length} not reported before`
      : null,
  ].filter((part): part is string => part !== null)

  return {
    // Never starts with a square bracket: that is how the old job's internal alerts are told
    // apart from customer emails.
    subject: `Invoice reminders, ${formatInvoiceDate(input.today)}: ${counts.join(', ')}`,
    text: [heading, ...sections].map((block) => block.join('\n')).join('\n\n'),
  }
}
