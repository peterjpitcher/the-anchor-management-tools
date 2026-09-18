import type { MessagingFlagKey } from '@/lib/messaging/flags'
import { isDepositAwaitingConfirmation } from '@/lib/private-bookings/deposit-confirmation'
import { readStalePendingOutcomes, type StalePendingOutcome } from '@/lib/private-bookings/stale-outcomes'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { hasOutstandingBalance, type WeeklyDigestBookingRow } from '@/lib/private-bookings/weekly-digest-classifier'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { formatCount, formatDayDate, formatLondonClock, formatMoney, formatTimeOfDay, plural } from '../format'
import { PRIVATE_HIRE } from '../thresholds'
import { addDays, isInRange, londonDateOf } from '../windows'
import type {
  InsightAction,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
  UpcomingItem,
} from '../types'

/**
 * Private hire (spec 5.6). Three scopes that never mix in counts:
 *
 * 1. Upcoming: bookings dated in the next 14 days, not cancelled, with every check.
 * 2. Further ahead: on later bookings, red hold and payment problems, a deposit still to be
 *    confirmed, and texts waiting for approval.
 * 3. Past: bookings whose outcome email went more than 14 days ago with no outcome recorded.
 *
 * Texts waiting for approval are checked on every booking: the balance reminders that wait for
 * approval are queued 14 to 21 days before the event, before it enters the upcoming scope.
 * Pending texts for past or cancelled bookings are counted once, as a queue line.
 *
 * Client names are printed in the email because the reader acts on that client
 * (decision 13). Contact details are never read into the report.
 */

const HOUR_MS = 60 * 60 * 1000

/** The booking read goes through the view because balance_remaining is only computed there. */
const VIEW_COLUMNS = 'id, customer_name, customer_first_name, customer_last_name, status, event_date, start_time, end_time, date_tbd, hold_expiry, updated_at, guest_count, event_type, balance_due_date, balance_remaining, final_payment_date, internal_notes, deposit_amount, deposit_paid_date, contract_version'

/** The view ignores deposit waivers and carries no invoice link or deposit confirmation, so they come from the table. */
const TABLE_COLUMNS = 'id, deposit_waived, deposit_confirmed_at, invoice_id, invoice:invoices!private_bookings_invoice_id_fkey(id, invoice_number, status, due_date, total_amount, paid_amount, deleted_at)'

/**
 * The switch the rest of the app reads through isMessagingFlagOn (src/lib/messaging/flags.ts):
 * one system_settings row holding an object of booleans. While private_booking_deposit_confirmation
 * is on, a new booking's deposit waits for staff to confirm it; until then the guest has not been
 * asked for it and the hold does not run (the expiry cron and deposit reminders skip it).
 */
const MESSAGING_FLAGS_KEY = 'messaging_flags'
const DEPOSIT_CONFIRMATION_FLAG: MessagingFlagKey = 'private_booking_deposit_confirmation'

interface ViewRow {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  status: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  date_tbd: boolean | null
  hold_expiry: string | null
  updated_at: string | null
  guest_count: number | null
  event_type: string | null
  balance_due_date: string | null
  balance_remaining: number | string | null
  final_payment_date: string | null
  internal_notes: string | null
  deposit_amount: number | string | null
  deposit_paid_date: string | null
  contract_version: number | null
}

interface InvoiceRow {
  id: string
  invoice_number: string | null
  status: string | null
  due_date: string | null
  total_amount: number | string | null
  paid_amount: number | string | null
  deleted_at: string | null
}

interface TableRow {
  id: string
  deposit_waived: boolean | null
  deposit_confirmed_at?: string | null
  invoice_id: string | null
  invoice: InvoiceRow | InvoiceRow[] | null
}

interface PendingTextRow {
  id: string
  booking_id: string | null
}

/** The invoice that settles an invoiced booking, when it still can. */
interface LinkedInvoice {
  id: string
  /** "invoice INV-001", or "the invoice" in the unlikely case it has no number. */
  name: string
  dueDate: string | null
  outstanding: number
}

interface Booking {
  id: string
  /** "Smith party". */
  label: string
  eventDate: string
  status: string
  startTime: string | null
  endTime: string | null
  dateTbd: boolean
  guestCount: number | null
  holdExpiryMs: number | null
  holdExpiry: string | null
  depositAmount: number | null
  depositPaid: boolean
  depositWaived: boolean
  /** The deposit is still to be confirmed by staff, so the guest has not been asked and the hold is not running. */
  depositAwaitingConfirmation: boolean
  contractGenerated: boolean
  balanceDueDate: string | null
  /** The classifier's rule: balance above zero and no final payment recorded. */
  balanceOutstanding: number | null
  invoiced: boolean
  invoice: LinkedInvoice | null
  pendingTexts: number
}

interface Check {
  rule: string
  rag: Rag
  kind: 'issue' | 'info'
  /** A few words for the page list and the "Coming up" line, e.g. "no contract generated". */
  short: string
  text: string
  action?: InsightAction
}

function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : null
}

function roundPence(amount: number): number {
  return Math.round(amount * 100) / 100
}

/** "£250" or "£1,234.50": pence only when there are some. */
function money(amount: number): string {
  const exact = roundPence(amount)
  return formatMoney(exact, { pence: Math.round(exact * 100) % 100 !== 0 })
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** "Smith party": the surname where there is one, otherwise the name on the booking. */
function clientLabel(names: { customer_last_name?: string | null; customer_name?: string | null; customer_first_name?: string | null }): string {
  const name = trimmed(names.customer_last_name) ?? trimmed(names.customer_name) ?? trimmed(names.customer_first_name) ?? 'Unnamed client'
  return `${name} party`
}

function firstInvoice(value: TableRow['invoice']): InvoiceRow | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * The invoice decides for an invoiced booking (spec 5.6), unless it has been withdrawn
 * or deleted, when the booking's own balance is used instead and a note says so.
 */
function linkedInvoice(row: InvoiceRow | null): LinkedInvoice | null {
  if (!row || row.deleted_at) return null
  if (row.status && (PRIVATE_HIRE.withdrawnInvoiceStatuses as readonly string[]).includes(row.status)) return null
  const total = toAmount(row.total_amount)
  const paid = toAmount(row.paid_amount) ?? 0
  if (total === null) return null
  const outstanding = row.status === 'paid' ? 0 : Math.max(0, roundPence(total - paid))
  const number = trimmed(row.invoice_number)
  return { id: row.id, name: number ? `invoice ${number}` : 'the invoice', dueDate: row.due_date ? row.due_date.slice(0, 10) : null, outstanding }
}

/** On only when the stored value is an object whose entry is the boolean true, as isMessagingFlagOn reads it. */
function isFlagOn(value: unknown, flag: MessagingFlagKey): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return (value as Record<string, unknown>)[flag] === true
}

function toBooking(view: ViewRow, table: TableRow, pendingTexts: number, depositConfirmationOn: boolean): Booking {
  const holdMs = view.hold_expiry ? Date.parse(view.hold_expiry) : Number.NaN
  const balance = toAmount(view.balance_remaining)
  // Normalised for the shared classifier rule, which expects a number.
  const classifierRow: WeeklyDigestBookingRow = {
    id: view.id,
    customer_name: view.customer_name,
    customer_first_name: view.customer_first_name,
    customer_last_name: view.customer_last_name,
    status: view.status,
    event_date: view.event_date,
    start_time: view.start_time,
    hold_expiry: view.hold_expiry,
    updated_at: view.updated_at,
    guest_count: view.guest_count,
    event_type: view.event_type,
    contact_email: null,
    contact_phone: null,
    balance_due_date: view.balance_due_date,
    balance_remaining: balance,
    final_payment_date: view.final_payment_date,
    internal_notes: view.internal_notes,
  }
  const invoice = table.invoice_id ? linkedInvoice(firstInvoice(table.invoice)) : null
  return {
    id: view.id,
    label: clientLabel(view),
    eventDate: String(view.event_date).slice(0, 10),
    status: view.status ?? 'draft',
    startTime: formatTimeOfDay(view.start_time),
    endTime: formatTimeOfDay(view.end_time),
    dateTbd: isBookingDateTbd(view),
    guestCount: view.guest_count,
    holdExpiryMs: Number.isFinite(holdMs) ? holdMs : null,
    holdExpiry: Number.isFinite(holdMs) ? view.hold_expiry : null,
    depositAmount: toAmount(view.deposit_amount),
    depositPaid: Boolean(view.deposit_paid_date),
    depositWaived: table.deposit_waived === true,
    // The same rule as the booking page and list: only while the switch is on.
    depositAwaitingConfirmation: depositConfirmationOn && isDepositAwaitingConfirmation({
      status: view.status,
      deposit_amount: view.deposit_amount,
      deposit_paid_date: view.deposit_paid_date,
      deposit_waived: table.deposit_waived,
      deposit_confirmed_at: table.deposit_confirmed_at,
    }),
    contractGenerated: (view.contract_version ?? 0) > 0,
    balanceDueDate: view.balance_due_date ? view.balance_due_date.slice(0, 10) : null,
    balanceOutstanding: hasOutstandingBalance(classifierRow) && balance !== null ? roundPence(balance) : null,
    invoiced: Boolean(table.invoice_id),
    invoice,
    pendingTexts,
  }
}

function describeHoldExpiry(holdExpiryMs: number): string {
  const instant = new Date(holdExpiryMs)
  return `${formatDayDate(londonDateOf(instant))} at ${formatLondonClock(instant)}`
}

/** The London date a draft's hold ends, or null when no hold is running. */
function holdDate(booking: Booking): string | null {
  if (booking.depositAwaitingConfirmation) return null
  return booking.status === 'draft' && booking.holdExpiry ? londonDateOf(booking.holdExpiry) : null
}

function earlier(a: string | null, b: string): string {
  return a && a < b ? a : b
}

/**
 * Hold rule shared by the upcoming and further-ahead scopes. A hold only runs once the deposit is
 * confirmed: until then the expiry cron leaves the booking alone, so a stored expiry means nothing.
 */
function holdCheck(booking: Booking, ctx: SectionContext, who: string, recordHref: string): Check | null {
  if (booking.status !== 'draft' || booking.holdExpiryMs === null || booking.depositAwaitingConfirmation) return null
  const hoursLeft = (booking.holdExpiryMs - ctx.now.getTime()) / HOUR_MS
  const due = holdDate(booking) ?? booking.eventDate
  if (hoursLeft <= 0) {
    return {
      rule: 'hold_expired',
      rag: 'red',
      kind: 'issue',
      short: 'hold expired',
      text: `${who}: the hold expired on ${describeHoldExpiry(booking.holdExpiryMs)}.`,
      action: { text: `Extend the hold or release the date for the ${who}`, href: recordHref, target: 'record', dueDate: due, impact: 'customer' },
    }
  }
  if (hoursLeft <= PRIVATE_HIRE.holdExpiringHours) {
    return {
      rule: 'hold_expiring',
      rag: 'amber',
      kind: 'issue',
      short: 'hold expires within 48 hours',
      text: `${who}: the hold expires on ${describeHoldExpiry(booking.holdExpiryMs)}.`,
      action: { text: `Confirm the ${who} before the hold expires`, href: recordHref, target: 'record', dueDate: due, impact: 'customer' },
    }
  }
  return null
}

/**
 * Balance. For an invoiced booking the invoice decides: overdue is red, not yet due is a
 * green note. Otherwise the classifier's outstanding-balance rule applies; `overdueOnly`
 * limits it to balances past their due date (the further-ahead scope).
 */
function balanceCheck(booking: Booking, ctx: SectionContext, who: string, recordHref: string, overdueOnly: boolean): Check | null {
  const today = ctx.windows.today
  if (booking.invoice) {
    const invoice = booking.invoice
    if (invoice.outstanding <= 0) return null
    const overdue = invoice.dueDate !== null && invoice.dueDate < today
    if (overdue) {
      return {
        rule: 'invoice_overdue',
        rag: 'red',
        kind: 'issue',
        short: `${invoice.name} overdue, ${money(invoice.outstanding)}`,
        text: `${who}: ${invoice.name} is overdue, ${money(invoice.outstanding)} outstanding.`,
        action: {
          text: `Chase ${invoice.name} for the ${who}, ${money(invoice.outstanding)}`,
          href: ctx.link(`/invoices/${invoice.id}`),
          target: 'record',
          dueDate: invoice.dueDate ?? undefined,
          impact: 'money',
        },
      }
    }
    if (overdueOnly) return null
    const due = invoice.dueDate ? `, due ${formatDayDate(invoice.dueDate)}` : ''
    return {
      rule: 'invoice_not_due',
      rag: 'green',
      kind: 'info',
      short: `balance invoiced, ${invoice.name}${due}`,
      text: `${who}: ${money(invoice.outstanding)} balance invoiced on ${invoice.name}${due}.`,
    }
  }
  if (booking.balanceOutstanding === null || booking.balanceOutstanding <= 0) return null
  const dueDate = booking.balanceDueDate ?? addDays(booking.eventDate, -PRIVATE_HIRE.balanceDueDaysBefore)
  const overdue = dueDate < today
  if (overdueOnly && !overdue) return null
  const amount = money(booking.balanceOutstanding)
  return {
    rule: overdue ? 'balance_overdue' : 'balance',
    rag: 'red',
    kind: 'issue',
    short: overdue ? `${amount} balance overdue` : `${amount} balance outstanding`,
    text: overdue
      ? `${who}: ${amount} balance overdue since ${formatDayDate(dueDate)}.`
      : `${who}: ${amount} balance outstanding, due ${formatDayDate(dueDate)}.`,
    action: { text: `Collect the ${amount} balance for the ${who}`, href: recordHref, target: 'record', dueDate, impact: 'money' },
  }
}

/** A deposit the guest has been asked for and has not paid. */
function depositUnpaidCheck(booking: Booking, who: string, recordHref: string): Check | null {
  if (booking.depositAmount === null || booking.depositAmount <= 0 || booking.depositPaid || booking.depositWaived) return null
  const amount = money(booking.depositAmount)
  return {
    rule: 'deposit',
    rag: 'red',
    kind: 'issue',
    short: `${amount} deposit not paid`,
    text: `${who}: ${amount} deposit not paid.`,
    action: { text: `Chase the ${amount} deposit for the ${who}`, href: recordHref, target: 'record', dueDate: earlier(holdDate(booking), booking.eventDate), impact: 'money' },
  }
}

/**
 * A deposit still to be confirmed by staff: the guest has not been asked for it, so the job is
 * to confirm it (which sends the one deposit request), not to chase it.
 */
function depositUnconfirmedCheck(booking: Booking, who: string, recordHref: string, rag: Rag): Check | null {
  if (!booking.depositAwaitingConfirmation || booking.depositAmount === null || booking.depositAmount <= 0) return null
  const amount = money(booking.depositAmount)
  return {
    rule: 'deposit_unconfirmed',
    rag,
    kind: 'issue',
    short: 'deposit not yet requested',
    text: `${who}: the ${amount} deposit has not been confirmed, so the guest has not been asked for it.`,
    action: { text: `Confirm the deposit for the ${who}`, href: recordHref, target: 'record', dueDate: booking.eventDate, impact: 'money' },
  }
}

/** Texts for this booking waiting in the approval queue; they never leave until someone sends them. */
function textsCheck(booking: Booking, ctx: SectionContext, who: string): Check | null {
  if (booking.pendingTexts <= 0) return null
  const texts = plural(booking.pendingTexts, 'text')
  return {
    rule: 'texts',
    rag: 'amber',
    kind: 'issue',
    short: `${texts} waiting for approval`,
    text: `${who}: ${texts} waiting for approval.`,
    action: { text: `Approve or cancel ${texts} for the ${who}`, href: ctx.link('/private-bookings/sms-queue'), target: 'list', dueDate: booking.eventDate, impact: 'customer' },
  }
}

/** Every check for a booking in the next 14 days, in the spec's precedence order. */
function upcomingChecks(booking: Booking, ctx: SectionContext): Check[] {
  const who = `${booking.label} (${formatDayDate(booking.eventDate)})`
  const recordHref = ctx.link(`/private-bookings/${booking.id}`)
  const checks: Check[] = []
  const eventDate = booking.eventDate

  if (booking.status === 'draft') {
    checks.push({
      rule: 'not_confirmed',
      rag: 'red',
      kind: 'issue',
      short: 'not confirmed',
      text: `${who} is not confirmed: the booking is still a draft.`,
      action: { text: `Confirm the ${who} or release the date`, href: recordHref, target: 'record', dueDate: earlier(holdDate(booking), eventDate), impact: 'customer' },
    })
  }

  const hold = holdCheck(booking, ctx, who, recordHref)
  if (hold) checks.push(hold)

  const deposit = booking.depositAwaitingConfirmation
    ? depositUnconfirmedCheck(booking, who, recordHref, 'red')
    : depositUnpaidCheck(booking, who, recordHref)
  if (deposit) checks.push(deposit)

  const balance = balanceCheck(booking, ctx, who, recordHref, false)
  if (balance) checks.push(balance)

  if (booking.guestCount === null) {
    checks.push({
      rule: 'headcount',
      rag: 'amber',
      kind: 'issue',
      short: 'no headcount',
      text: `${who}: no headcount recorded.`,
      action: { text: `Get a headcount for the ${who}`, href: recordHref, target: 'record', dueDate: eventDate, impact: 'customer' },
    })
  }

  if (booking.dateTbd || !booking.startTime || !booking.endTime) {
    checks.push({
      rule: 'timings',
      rag: 'amber',
      kind: 'issue',
      short: booking.dateTbd ? 'date and time to be confirmed' : `${booking.startTime ? 'finish' : 'start'} time not set`,
      text: booking.dateTbd
        ? `${who}: the date and time are still to be confirmed.`
        : `${who}: ${booking.startTime ? 'finish time' : 'start time'} not set.`,
      action: { text: `Confirm the timings for the ${who}`, href: recordHref, target: 'record', dueDate: eventDate, impact: 'customer' },
    })
  }

  if (!booking.contractGenerated) {
    checks.push({
      rule: 'contract',
      rag: 'amber',
      kind: 'issue',
      short: 'no contract generated',
      text: `${who}: no contract generated.`,
      action: { text: `Generate the contract for the ${who}`, href: recordHref, target: 'record', dueDate: eventDate, impact: 'money' },
    })
  }

  const texts = textsCheck(booking, ctx, who)
  if (texts) checks.push(texts)

  return checks
}

/**
 * Later bookings (spec 5.6 scope 2): red hold and payment problems, a deposit still to be
 * confirmed (amber: there is time, but nobody has asked the guest for it) and texts waiting
 * for approval, which the balance reminders are 14 to 21 days before the event.
 */
function furtherAheadChecks(booking: Booking, ctx: SectionContext): Check[] {
  const who = `${booking.label} (${formatDayDate(booking.eventDate)})`
  const recordHref = ctx.link(`/private-bookings/${booking.id}`)
  const checks: Check[] = []
  const hold = holdCheck(booking, ctx, who, recordHref)
  if (hold && hold.rag === 'red') checks.push(hold)
  if (booking.depositAwaitingConfirmation) {
    const deposit = depositUnconfirmedCheck(booking, who, recordHref, 'amber')
    if (deposit) checks.push(deposit)
  }
  const balance = balanceCheck(booking, ctx, who, recordHref, true)
  if (balance && balance.rag === 'red') checks.push(balance)
  const texts = textsCheck(booking, ctx, who)
  if (texts) checks.push(texts)
  return checks
}

function outcomeCheck(outcome: StalePendingOutcome, ctx: SectionContext): Check {
  const label = clientLabel(outcome)
  const who = outcome.event_date ? `${label} (${formatDayDate(outcome.event_date)})` : label
  const days = plural(outcome.days_since_email, 'day')
  return {
    rule: 'outcome',
    rag: 'amber',
    kind: 'issue',
    short: `outcome not recorded, email sent ${days} ago`,
    text: `${who}: outcome not recorded; the outcome email went ${days} ago.`,
    action: { text: `Record how the ${who} went`, href: ctx.link(`/private-bookings/${outcome.booking_id}`), target: 'record', impact: 'customer' },
  }
}

function toSignals(bookingId: string, checks: Check[]): InsightSignal[] {
  return checks.map((check) => ({
    key: `private_hire.${check.rule}.${bookingId}`,
    entity: `private_booking:${bookingId}`,
    rag: check.rag,
    kind: check.kind,
    text: check.text,
    ...(check.action ? { action: check.action } : {}),
    // Names only the client, whom the reader acts on (decision 13).
    emailSafe: true,
  }))
}

function worstRag(checks: Check[]): Rag {
  const issues = checks.filter((check) => check.kind === 'issue')
  if (issues.some((check) => check.rag === 'red')) return 'red'
  if (issues.some((check) => check.rag === 'amber')) return 'amber'
  return 'green'
}

function describeTimes(booking: Booking): string {
  if (booking.dateTbd) return 'time to be confirmed'
  if (booking.startTime && booking.endTime) return `${booking.startTime} to ${booking.endTime}`
  if (booking.startTime) return `from ${booking.startTime}`
  return 'time not set'
}

function upcomingListItem(booking: Booking, checks: Check[], ctx: SectionContext): InsightListItem {
  const issues = checks.filter((check) => check.kind === 'issue').map((check) => check.short)
  const info = checks.filter((check) => check.kind === 'info').map((check) => check.short)
  const guests = booking.guestCount === null ? 'headcount not set' : plural(booking.guestCount, 'guest')
  const state = issues.length > 0
    ? issues.join(', ')
    : info.length > 0 ? `Ready (${info.join(', ')})` : 'Ready'
  return {
    text: `${formatDayDate(booking.eventDate)}, ${describeTimes(booking)}, ${booking.label}, ${guests}, ${booking.status}: ${state}`,
    href: ctx.link(`/private-bookings/${booking.id}`),
    rag: worstRag(checks),
  }
}

function needsVerb(count: number): string {
  return count === 1 ? 'needs' : 'need'
}

function compareBookings(a: Booking, b: Booking): number {
  return a.eventDate.localeCompare(b.eventDate)
    || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99')
    || a.id.localeCompare(b.id)
}

export async function buildPrivateHireSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { today, next7, next14 } = ctx.windows
  const pipelineEnd = addDays(today, PRIVATE_HIRE.pipelineDays - 1)

  const [viewRows, tableRows, pendingTexts, staleOutcomes, flagsResult] = await Promise.all([
    fetchAllRows<ViewRow>(
      (from, to) => ctx.db
        .from('private_bookings_with_details')
        .select(VIEW_COLUMNS)
        .gte('event_date', today)
        .neq('status', 'cancelled')
        .order('id', { ascending: true })
        .range(from, to),
      { label: 'private hire bookings' },
    ),
    fetchAllRows<TableRow>(
      (from, to) => ctx.db
        .from('private_bookings')
        .select(TABLE_COLUMNS)
        .gte('event_date', today)
        .neq('status', 'cancelled')
        .order('id', { ascending: true })
        .range(from, to),
      { label: 'private hire deposits and invoices' },
    ),
    fetchAllRows<PendingTextRow>(
      (from, to) => ctx.db
        .from('private_booking_sms_queue')
        .select('id, booking_id')
        .eq('status', 'pending')
        .order('id', { ascending: true })
        .range(from, to),
      { label: 'private hire texts awaiting approval' },
    ),
    readStalePendingOutcomes(ctx.db, ctx.now),
    ctx.db
      .from('system_settings')
      .select('value')
      .eq('key', MESSAGING_FLAGS_KEY)
      .maybeSingle(),
  ])
  // Unread, the switch could turn every unconfirmed deposit into a false "hold expired", so the
  // section fails rather than guessing. A missing row means off, as it does for the app.
  if (flagsResult.error) throw new Error(`insights private hire messaging flags failed: ${flagsResult.error.message}`)
  const depositConfirmationOn = isFlagOn((flagsResult.data as { value?: unknown } | null)?.value, DEPOSIT_CONFIRMATION_FLAG)

  const textsByBooking = new Map<string, number>()
  for (const row of pendingTexts) {
    if (row.booking_id) textsByBooking.set(row.booking_id, (textsByBooking.get(row.booking_id) ?? 0) + 1)
  }

  // The two reads run together; a booking created or cancelled between them is left for the
  // next report rather than judged on half its data.
  const tableById = new Map(tableRows.map((row) => [row.id, row]))
  const bookings = viewRows
    .filter((row) => row.event_date && tableById.has(row.id))
    .map((row) => toBooking(row, tableById.get(row.id) as TableRow, textsByBooking.get(row.id) ?? 0, depositConfirmationOn))
    .sort(compareBookings)

  const withdrawnInvoices = bookings.filter((booking) => booking.invoiced && !booking.invoice).length

  // Scope 1: upcoming.
  const upcoming = bookings.filter((booking) => isInRange(booking.eventDate, next14))
  const upcomingEntries = upcoming.map((booking) => ({ booking, checks: upcomingChecks(booking, ctx) }))
  const needAction = upcomingEntries.filter(({ checks }) => checks.some((check) => check.kind === 'issue')).length

  // Scope 2: further ahead, red hold and payment problems, unconfirmed deposits and pending texts.
  const later = bookings.filter((booking) => booking.eventDate > next14.end)
  const laterEntries = later
    .map((booking) => ({ booking, checks: furtherAheadChecks(booking, ctx) }))
    .filter(({ checks }) => checks.length > 0)

  // Scope 3: past bookings with no outcome recorded. Kept apart from the other two scopes.
  const futureIds = new Set(bookings.map((booking) => booking.id))
  const pastOutcomes = staleOutcomes.filter((outcome) => !futureIds.has(outcome.booking_id))

  // Pending texts whose booking is not in the read: every queue row has a booking, and the read
  // holds every booking still to come that is not cancelled, so these are past or cancelled ones.
  const otherTexts = pendingTexts.filter((row) => !row.booking_id || !futureIds.has(row.booking_id)).length

  const signals: InsightSignal[] = [
    ...upcomingEntries.flatMap(({ booking, checks }) => toSignals(booking.id, checks)),
    ...laterEntries.flatMap(({ booking, checks }) => toSignals(booking.id, checks)),
    ...pastOutcomes.flatMap((outcome) => toSignals(outcome.booking_id, [outcomeCheck(outcome, ctx)])),
  ]
  const otherTextsFor = `${plural(otherTexts, 'text')} for ${otherTexts === 1 ? 'a past or cancelled booking' : 'past or cancelled bookings'}`
  if (otherTexts > 0) {
    signals.push({
      key: 'private_hire.texts_other.queue',
      rag: 'amber',
      kind: 'issue',
      text: `${otherTextsFor} ${otherTexts === 1 ? 'is' : 'are'} waiting for approval.`,
      action: { text: `Approve or cancel ${otherTextsFor}`, href: ctx.link('/private-bookings/sms-queue'), target: 'list', impact: 'customer' },
      // Names nobody.
      emailSafe: true,
    })
  }

  const pipeline = bookings.filter((booking) => booking.eventDate <= pipelineEnd)
  const confirmed = pipeline.filter((booking) => booking.status === 'confirmed').length
  const drafts = pipeline.filter((booking) => booking.status === 'draft').length

  const headlineParts: string[] = []
  if (upcoming.length === 0) {
    headlineParts.push('No private bookings in the next 14 days')
  } else {
    const state = needAction === 0 ? 'all ready' : `${needAction} ${needsVerb(needAction)} action`
    headlineParts.push(`${plural(upcoming.length, 'private booking')} in the next 14 days, ${state}`)
  }
  if (laterEntries.length > 0) headlineParts.push(`${plural(laterEntries.length, 'later booking')} ${needsVerb(laterEntries.length)} action`)
  if (pastOutcomes.length > 0) headlineParts.push(`${plural(pastOutcomes.length, 'past booking')} with no outcome recorded`)
  if (otherTexts > 0) headlineParts.push(`${otherTextsFor} waiting for approval`)
  const headline = `${headlineParts.join('; ')}.`

  const metrics: InsightMetric[] = [
    {
      label: 'Next 14 days',
      value: plural(upcoming.length, 'booking'),
      ...(upcoming.length > 0 ? { comparison: needAction === 0 ? 'all ready' : `${needAction} ${needsVerb(needAction)} action` } : {}),
    },
    { label: `Next ${PRIVATE_HIRE.pipelineDays} days`, value: `${formatCount(confirmed)} confirmed, ${formatCount(drafts)} draft` },
    { label: 'Later bookings needing action', value: plural(laterEntries.length, 'booking') },
    { label: 'Outcomes not recorded', value: plural(pastOutcomes.length, 'past booking') },
  ]

  const lists: InsightList[] = [
    {
      title: 'Next 14 days',
      items: upcomingEntries.map(({ booking, checks }) => upcomingListItem(booking, checks, ctx)),
      emptyText: 'No private bookings in the next 14 days.',
    },
  ]
  if (laterEntries.length > 0) {
    lists.push({
      title: 'Further ahead: needs action',
      items: laterEntries.map(({ booking, checks }) => ({
        text: `${formatDayDate(booking.eventDate)}, ${booking.label}, ${booking.status}: ${checks.map((check) => check.short).join(', ')}`,
        href: ctx.link(`/private-bookings/${booking.id}`),
        rag: worstRag(checks),
      })),
    })
  }
  if (pastOutcomes.length > 0) {
    lists.push({
      title: 'Past: outcome not recorded',
      items: pastOutcomes.map((outcome) => {
        const check = outcomeCheck(outcome, ctx)
        const date = outcome.event_date ? `${formatDayDate(outcome.event_date)}, ` : ''
        return { text: `${date}${clientLabel(outcome)}: ${check.short}`, href: ctx.link(`/private-bookings/${outcome.booking_id}`), rag: 'amber' as const }
      }),
    })
  }

  const notes: string[] = []
  if (withdrawnInvoices > 0) {
    notes.push(`${plural(withdrawnInvoices, 'booking')} ${withdrawnInvoices === 1 ? 'links' : 'link'} to a withdrawn or deleted invoice, so the balance shown comes from the booking.`)
  }
  notes.push(`Not tracked in the app: ${PRIVATE_HIRE.notTracked.join(', ')}.`)

  const upcomingItems: UpcomingItem[] = upcomingEntries
    .filter(({ booking }) => isInRange(booking.eventDate, next7))
    .map(({ booking, checks }) => {
      const firstIssue = checks.find((check) => check.kind === 'issue')
      return {
        date: booking.eventDate,
        text: `${booking.label}, ${formatDayDate(booking.eventDate)}: ${firstIssue ? firstIssue.short : 'ready'}`,
        hasIssue: Boolean(firstIssue),
        href: ctx.link(`/private-bookings/${booking.id}`),
      }
    })

  return { headline, metrics, lists, signals, notes, upcoming: upcomingItems }
}

export const privateHireSection: SectionDefinition = {
  key: 'private_hire',
  title: 'Private hire',
  path: '/private-bookings',
  build: buildPrivateHireSection,
}
