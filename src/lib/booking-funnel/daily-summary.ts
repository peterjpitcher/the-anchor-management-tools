import { escapeHtml } from '@/lib/cron/alerting'
import { formatDateInLondon, shiftIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { STAFF } from '@/lib/brand/palette'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * The daily summary of website bookings that were turned away (BK-101, customer bookings review
 * of 24 October 2026). Owner decision D17: website refusals go to the manager inbox as ONE email
 * a day, not one each. Built from booking_funnel_events for one London day.
 *
 * It is sent only when something was turned away: a refusal, a failure, an availability check
 * that could not be worked out, or a booking form blocked before it could send. Codes and counts
 * only; booking_funnel_events holds no guest details, so neither does this.
 */

type AdminClient = ReturnType<typeof createAdminClient>

const ROW_LIMIT = 1000
/** At most 50,000 refusal and form rows a day are read; a day with more is marked truncated. */
const MAX_PAGES = 50

export type RefusalLine = {
  route: string
  stage: 'refused' | 'failed'
  reason: string
  upstreamCode: string | null
  count: number
}

export type FormLine = { form: string; step: string; reason: string | null; count: number }

export type DailyFunnelSummary = {
  /** The London date summarised, YYYY-MM-DD. */
  date: string
  refusals: RefusalLine[]
  refusedTotal: number
  failedTotal: number
  availability: { searches: number; noTables: number; couldNotCheck: number }
  forms: FormLine[]
  /** True when the day had more refusal and form rows than the summary reads (ROW_LIMIT x MAX_PAGES). */
  truncated: boolean
  readError: string | null
}

/** Keys that can make bookings: the website's own. A read-only test or preview key is left out (BK-193). */
export async function funnelKeyIds(supabase: AdminClient): Promise<string[]> {
  const { data, error } = await supabase.from('api_keys').select('id, permissions').limit(ROW_LIMIT)
  if (error) throw new Error(`Could not read the API keys: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; permissions: unknown }>)
    .filter((key) => Array.isArray(key.permissions) && key.permissions.includes('create:bookings'))
    .map((key) => key.id)
}

function londonDayBounds(date: string): { startIso: string; endIso: string } {
  const start = whenLondonClockReaches(date, '00:00')
  const nextDate = shiftIsoDate(date, 1)
  const end = nextDate ? whenLondonClockReaches(nextDate, '00:00') : null
  if (!start || !end) throw new Error(`Not a date: ${date}`)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

export async function loadDailyFunnelSummary(supabase: AdminClient, date: string): Promise<DailyFunnelSummary> {
  const summary: DailyFunnelSummary = {
    date,
    refusals: [],
    refusedTotal: 0,
    failedTotal: 0,
    availability: { searches: 0, noTables: 0, couldNotCheck: 0 },
    forms: [],
    truncated: false,
    readError: null,
  }

  const { startIso, endIso } = londonDayBounds(date)
  const keys = await funnelKeyIds(supabase)
  if (keys.length === 0) {
    summary.readError = 'No API key that can make bookings was found, so nothing could be counted.'
    return summary
  }

  // The website asks about drinks on every search (food only refines it), so a drinks answer is
  // one guest search.
  const drinksAnswers = () =>
    supabase
      .from('booking_funnel_events')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'availability')
      .eq('purpose', 'drinks')
      .in('api_key_id', keys)
      .gte('occurred_at', startIso)
      .lt('occurred_at', endIso)

  const [all, empty, unknown] = await Promise.all([
    drinksAnswers(),
    drinksAnswers().eq('calculation_state', 'complete').eq('slots_offered', 0),
    drinksAnswers().eq('calculation_state', 'unknown'),
  ])
  for (const result of [all, empty, unknown]) {
    if (result.error) throw new Error(`Could not count availability answers: ${result.error.message}`)
  }
  const [searches, noTables, couldNotCheck] = [all.count ?? 0, empty.count ?? 0, unknown.count ?? 0]
  summary.availability = { searches, noTables, couldNotCheck }

  // Read in pages: one read of 1,000 rows let a busy day of ordinary form signals push every later
  // refusal off the end, and the day could then send nothing at all. Bounded so a flood cannot
  // run the job out of time; a day past the bound says so.
  type EventRow = { stage: string; route: string; reason_code: string | null; upstream_code: string | null }
  const rows: EventRow[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * ROW_LIMIT
    const { data, error } = await supabase
      .from('booking_funnel_events')
      .select('stage, route, reason_code, upstream_code')
      .in('stage', ['refused', 'failed', 'form'])
      .in('api_key_id', keys)
      .gte('occurred_at', startIso)
      .lt('occurred_at', endIso)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + ROW_LIMIT - 1)
    if (error) throw new Error(`Could not read the refusals: ${error.message}`)
    const batch = (data ?? []) as EventRow[]
    rows.push(...batch)
    if (batch.length < ROW_LIMIT) break
    if (page === MAX_PAGES - 1) summary.truncated = true
  }

  const refusals = new Map<string, RefusalLine>()
  const forms = new Map<string, FormLine>()
  for (const row of rows) {
    if (row.stage === 'refused' || row.stage === 'failed') {
      const reason = row.reason_code ?? 'UNSPECIFIED'
      const key = [row.stage, row.route, reason, row.upstream_code ?? ''].join('|')
      const line = refusals.get(key) ?? { route: row.route, stage: row.stage, reason, upstreamCode: row.upstream_code ?? null, count: 0 }
      line.count += 1
      refusals.set(key, line)
      if (row.stage === 'refused') summary.refusedTotal += 1
      else summary.failedTotal += 1
    } else if (row.stage === 'form' && row.reason_code) {
      const reason = row.reason_code === 'blocked' ? row.upstream_code ?? null : null
      const key = [row.route, row.reason_code, reason ?? ''].join('|')
      const line = forms.get(key) ?? { form: row.route, step: row.reason_code, reason, count: 0 }
      line.count += 1
      forms.set(key, line)
    }
  }

  summary.refusals = [...refusals.values()].sort(
    (a, b) => (a.stage === b.stage ? 0 : a.stage === 'failed' ? -1 : 1) || b.count - a.count || a.route.localeCompare(b.route),
  )
  summary.forms = [...forms.values()].sort((a, b) => a.form.localeCompare(b.form) || a.step.localeCompare(b.step))
  return summary
}

/** Something was turned away, so the summary goes out. A quiet day sends nothing. */
export function summaryNeedsSending(summary: DailyFunnelSummary): boolean {
  const formsBlocked = summary.forms.filter((line) => line.step === 'blocked').reduce((sum, line) => sum + line.count, 0)
  return (
    summary.refusedTotal + summary.failedTotal + summary.availability.couldNotCheck + formsBlocked > 0 ||
    // A day too busy to read in full is itself worth an email.
    summary.truncated ||
    Boolean(summary.readError)
  )
}

const ROUTE_LABELS: Record<string, string> = {
  'api/table-bookings': 'Table bookings',
  'api/table-bookings/paypal/create-order': 'Table deposit: starting a payment',
  'api/table-bookings/paypal/capture-order': 'Table deposit: taking a payment',
  'api/event-bookings': 'Event bookings',
  'api/event-bookings/paypal/create-order': 'Event tickets: starting a payment',
  'api/event-bookings/paypal/capture-order': 'Event tickets: taking a payment',
  'api/event-waitlist': 'Event waitlist',
  'api/public/private-booking': 'Private hire enquiries',
  'api/enquiry/christmas': 'Christmas enquiries',
  'api/enquiry/recruitment': 'Job applications',
  'api/careers': 'Job applications (careers form)',
  'api/parking/payment/create-order': 'Parking: starting a payment',
  'api/parking/payment/capture': 'Parking: taking a payment',
  'lib/turnstile': 'The security check on every form',
}

const REASON_LABELS: Record<string, string> = {
  VALIDATION_FAILED: 'a detail the guest was asked to correct',
  OUTSIDE_HOURS: 'a time outside online booking hours',
  BEYOND_BOOKING_HORIZON: 'a date more than a year ahead',
  SPAM_HONEYPOT: 'the hidden spam field was filled in',
  SPAM_TIMING_MISSING: 'the form sent no timing, as bots do',
  SPAM_TIMING_TOO_FAST: 'the form was sent faster than a person can type',
  SECURITY_CHECK_MISSING: 'no security check token: the check never loaded or was not finished',
  SECURITY_CHECK_REJECTED: 'the security check was rejected',
  SECURITY_CHECK_UNAVAILABLE: 'the security check could not be reached',
  CONTRACT_DRIFT: 'the management app refused something the website had accepted, so the two disagree about the rules',
  UPSTREAM_NOT_OK: 'the management app said no',
  BLOCKED: 'no table could be found',
}

const FORM_LABELS: Record<string, string> = { event_booking: 'Event booking form' }
const STEP_LABELS: Record<string, string> = {
  opened: 'opened',
  submit_pressed: 'submit pressed',
  blocked: 'blocked before sending',
  sent: 'sent',
}

function describeRefusal(line: RefusalLine): string {
  const where = ROUTE_LABELS[line.route] ?? line.route
  const why = REASON_LABELS[line.reason] ?? line.reason
  const code = line.upstreamCode ? ` (code ${line.upstreamCode})` : ''
  const kind = line.stage === 'failed' ? 'Failed' : 'Refused'
  return `${where}: ${kind}, ${why}${code}. ${line.count} time${line.count === 1 ? '' : 's'}.`
}

function describeForms(forms: FormLine[]): string[] {
  const byForm = new Map<string, FormLine[]>()
  for (const line of forms) byForm.set(line.form, [...(byForm.get(line.form) ?? []), line])
  return [...byForm.entries()].map(([form, lines]) => {
    const totals = new Map<string, number>()
    const blockedReasons: string[] = []
    for (const line of lines) {
      totals.set(line.step, (totals.get(line.step) ?? 0) + line.count)
      if (line.step === 'blocked' && line.reason) blockedReasons.push(`${line.reason.replace(/_/g, ' ')} ${line.count}`)
    }
    const parts = ['opened', 'submit_pressed', 'blocked', 'sent'].map(
      (step) => `${STEP_LABELS[step]} ${totals.get(step) ?? 0}${step === 'blocked' && blockedReasons.length > 0 ? ` (${blockedReasons.join(', ')})` : ''}`,
    )
    return `${FORM_LABELS[form] ?? form}: ${parts.join(', ')}.`
  })
}

export type DailyFunnelEmail = { subject: string; html: string; text: string }

export function buildDailyFunnelEmail(summary: DailyFunnelSummary, reportsUrl: string | null): DailyFunnelEmail {
  const day = formatDateInLondon(`${summary.date}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })
  const counts: string[] = []
  if (summary.refusedTotal > 0) counts.push(`${summary.refusedTotal} refused`)
  if (summary.failedTotal > 0) counts.push(`${summary.failedTotal} failed`)
  if (summary.availability.couldNotCheck > 0) {
    counts.push(`${summary.availability.couldNotCheck} availability check${summary.availability.couldNotCheck === 1 ? '' : 's'} failed`)
  }
  const subject = `Website bookings turned away on ${day}: ${counts.length > 0 ? counts.join(', ') : 'see inside'}`

  const intro =
    `What the website turned away on ${day}. Refused means the guest was told why and could try again or ring; ` +
    'failed means something broke on our side, or the website and the management app disagreed about the rules, and a ' +
    'failure also sent its own alert at the time.'

  const refusalLines = summary.refusals.map(describeRefusal)
  if (refusalLines.length === 0) refusalLines.push('No booking was refused or failed.')
  if (summary.truncated) refusalLines.push(`More than ${ROW_LIMIT * MAX_PAGES} were recorded; only the first ${ROW_LIMIT * MAX_PAGES} are counted here.`)

  const availabilityLines = [
    `Table searches: ${summary.availability.searches}.`,
    `No tables offered: ${summary.availability.noTables}.`,
    `Could not check (the guest was asked to try again or ring): ${summary.availability.couldNotCheck}.`,
  ]
  const formLines = describeForms(summary.forms)
  const problemLines = summary.readError ? [`This summary may be incomplete: ${summary.readError}`] : []

  const footer = [
    reportsUrl ? `The weekly funnel is on Table Bookings, Reports: ${reportsUrl}` : 'The weekly funnel is on Table Bookings, Reports.',
    'No guest details are kept or sent: only codes and counts. Searches made with a test or preview key are left out.',
  ]

  const sections: Array<{ title: string; lines: string[] }> = [
    { title: 'Refused and failed', lines: [...problemLines, ...refusalLines] },
    { title: 'Table availability', lines: availabilityLines },
  ]
  if (formLines.length > 0) sections.push({ title: 'Booking forms', lines: formLines })

  const text = [intro, '', ...sections.flatMap((section) => [section.title, ...section.lines.map((line) => `- ${line}`), '']), ...footer].join('\n')
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:${STAFF.text};">${escapeHtml(subject)}</h2>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(intro)}</p>
      ${sections
        .map(
          (section) => `
      <h3 style="font-size:15px;margin:16px 0 4px;">${escapeHtml(section.title)}</h3>
      <ul style="font-size:14px;line-height:1.5;margin:0;padding-left:20px;">
        ${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n        ')}
      </ul>`,
        )
        .join('')}
      ${footer.map((line) => `<p style="font-size:13px;line-height:1.5;color:${STAFF.textMuted};">${escapeHtml(line)}</p>`).join('\n      ')}
    </div>`.trim()

  return { subject, html, text }
}
