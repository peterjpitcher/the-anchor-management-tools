/**
 * The default wording of every invoice email: one voice, one greeting rule, one sign-off.
 *
 * Owner brief, 4 October 2026: "Everything should be over email and should feel personal."
 * Before this module there were about fifteen wordings spread over a dozen files, several
 * different sign-offs and three phone numbers, and the automatic ones greeted the company
 * ("Dear Golden Barrels Limited") and signed off as a company.
 *
 * Rules that hold for everything here:
 *  - Greet a person by first name, never a company. No name means "Hi there".
 *  - One sign-off, `INVOICE_SIGN_OFF`. It is fixed text on purpose: it must not read
 *    COMPANY_CONTACT_PHONE, which holds the pub landline in production.
 *  - `balance` always means what is still to pay, never the invoice total. Callers pass the
 *    figure from `invoiceBalanceDue` (src/lib/invoices/balance.ts), which already allows for
 *    credit notes.
 *  - Plain text. No pay link in here: the server adds it as a P.S. (see `payOnlinePostscript`
 *    and payment-link-footer.ts), because the link token must never be made in the browser.
 *  - These are DEFAULTS. Where staff can edit before sending, what they send is what goes.
 *
 * PURE: no server-only imports, no secrets, no database. The email dialogs import this in the
 * browser, and the tests render every wording against fixture data.
 */

export const INVOICE_SIGN_OFF = ['Many thanks,', 'Peter Pitcher', 'Orange Jelly Limited', '07990 587315'].join('\n')

/**
 * What an invoice email is, recorded with the email when it is sent
 * (`email_messages.metadata.document_kind`). The reminder job and the history panel read it.
 */
export type InvoiceEmailKind =
  | 'invoice'
  | 'reminder_first'
  | 'reminder_second'
  | 'chase'
  | 'receipt'

export interface InvoiceEmailDraft {
  subject: string
  body: string
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'rev'])

/**
 * The first name out of a person's full name, for a greeting.
 *
 * "Sam Example" gives "Sam"; "Dr Sam Example" gives "Sam"; a single word is returned as it is.
 * Returns null when there is nothing usable, so the caller falls back to "Hi there" rather
 * than printing an empty greeting. This is only ever given a PERSON's name (a contact or a
 * guest), never a company name: "Hi Golden," is the fault this module exists to end.
 */
export function firstNameFrom(fullName: string | null | undefined): string | null {
  if (!fullName) return null
  const words = String(fullName)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && TITLES.has(words[0].replace(/\.$/, '').toLowerCase())) {
    words.shift()
  }
  const first = (words[0] ?? '').replace(/[,;:]+$/, '')
  if (!first || TITLES.has(first.replace(/\.$/, '').toLowerCase())) return null
  return first
}

export function invoiceGreeting(firstName: string | null | undefined): string {
  const name = firstName?.trim()
  return `Hi ${name || 'there'},`
}

const MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export function formatInvoiceMoney(amount: number | string | null | undefined): string {
  const value = Number(amount)
  return MONEY.format(Number.isFinite(value) ? value : 0)
}

function parseIsoDate(value: string | null | undefined): Date | null {
  const iso = String(value ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const date = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * "Friday 9 October", or "Friday 9 October 2026" with `withYear`.
 *
 * Takes a calendar date (YYYY-MM-DD) and formats it in UTC, so the weekday cannot shift with
 * the server's time zone. The weekday is always computed, never typed: a wrong day of the week
 * in a customer message is a recorded lesson in this project. An unreadable date is returned
 * as it was given rather than printed as "Invalid Date".
 */
export function formatInvoiceDate(value: string | null | undefined, options: { withYear?: boolean } = {}): string {
  const date = parseIsoDate(value)
  if (!date) return String(value ?? '').trim()
  // Built from parts, not `format()`: en-GB puts a comma after the weekday as soon as a year is
  // asked for ("Thursday, 15 October 2026"), and the two forms must read the same.
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? ''
  const text = `${part('weekday')} ${part('day')} ${part('month')}`
  return options.withYear ? `${text} ${part('year')}` : text
}

/** "September" for any date in September. */
export function formatInvoiceMonth(value: string | null | undefined): string {
  const date = parseIsoDate(value)
  if (!date) return String(value ?? '').trim()
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(date)
}

/** The pay online line, added by the server after the sign-off. Receipts never carry it. */
export function payOnlinePostscript(url: string): string {
  return `P.S. You can also pay this online by card or PayPal: ${url}`
}

const BANK_LINE = 'The bank details are on the invoice.'
const QUESTIONS_LINE = 'Any questions, just reply to this email or give me a ring.'

function assemble(paragraphs: Array<string | null | undefined | false>): string {
  return [...paragraphs.filter((part): part is string => Boolean(part && part.trim())), INVOICE_SIGN_OFF].join('\n\n')
}

interface Figures {
  total: number
  paid: number
  credits?: number
  balance: number
}

/**
 * Total, payments, credits and balance as a block, shown only when something has already come
 * off the total. Credits are included whenever there are any, so the lines always add up.
 */
function figuresBlock({ total, paid, credits = 0, balance }: Figures, balanceLabel = 'Balance due'): string | null {
  if (!(paid > 0) && !(credits > 0)) return null
  return [
    `Invoice total: ${formatInvoiceMoney(total)}`,
    `Payments received: ${formatInvoiceMoney(paid)}`,
    credits > 0 ? `Credits: ${formatInvoiceMoney(credits)}` : null,
    `${balanceLabel}: ${formatInvoiceMoney(Math.max(0, balance))}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export interface InvoiceEmailInput extends Figures {
  firstName?: string | null
  invoiceNumber: string
  reference?: string | null
  dueDate: string
}

/** An invoice sent by hand from the invoice page, and one raised by a recurring schedule. */
export function buildInvoiceEmail(input: InvoiceEmailInput): InvoiceEmailDraft {
  const reference = input.reference?.trim()
  const referenceClause = reference ? ` (your reference: ${reference})` : ''
  const settled = !(input.balance > 0)

  const opening = settled
    ? `I hope you're well. Invoice ${input.invoiceNumber} is attached${referenceClause} for your records. It is settled in full, so there is nothing to pay.`
    : `I hope you're well. Invoice ${input.invoiceNumber} is attached${referenceClause}: ${formatInvoiceMoney(input.balance)}, due ${formatInvoiceDate(input.dueDate)}.`

  return {
    subject: `Invoice ${input.invoiceNumber} from Orange Jelly`,
    body: assemble([
      invoiceGreeting(input.firstName),
      opening,
      figuresBlock(input),
      settled ? QUESTIONS_LINE : `${BANK_LINE} ${QUESTIONS_LINE}`,
    ]),
  }
}

export interface MonthlyInvoiceEmailInput {
  firstName?: string | null
  invoiceNumber: string
  /** Any date inside the month the invoice is for. */
  periodDate: string
  balance: number
  dueDate: string
  /** True only when the invoice notes really do carry the hours and mileage breakdown. */
  breakdownOnInvoice?: boolean
  /** True only when the timesheet PDF is attached to this email. */
  timesheetAttached?: boolean
  /** True for clients on a statement: the invoice carries a balance summary. */
  balanceSummaryOnInvoice?: boolean
}

/** The invoice the monthly Orange Jelly billing run raises. Promises only what is attached. */
export function buildMonthlyInvoiceEmail(input: MonthlyInvoiceEmailInput): InvoiceEmailDraft {
  const month = formatInvoiceMonth(input.periodDate)
  const extras = [
    input.breakdownOnInvoice ? 'The breakdown of hours and mileage is on the invoice.' : null,
    input.balanceSummaryOnInvoice ? 'It includes a summary of your account balance.' : null,
    input.timesheetAttached ? 'The full timesheet is attached too.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    subject: `${month} invoice from Orange Jelly (${input.invoiceNumber})`,
    body: assemble([
      invoiceGreeting(input.firstName),
      `Here's the invoice for ${month}: ${formatInvoiceMoney(input.balance)}, due ${formatInvoiceDate(input.dueDate)}.${extras ? ` ${extras}` : ''}`,
      `${BANK_LINE} ${QUESTIONS_LINE}`,
    ]),
  }
}

export interface PrivateHireInvoiceEmailInput extends Figures {
  firstName?: string | null
  invoiceNumber: string
  eventDate?: string | null
  dueDate: string
  reference?: string | null
  /**
   * How the booking's deposit relates to this invoice, from the booking record. 'applied'
   * means it was taken off this invoice; 'held' means it is a separate bond. Omit it when
   * there is no deposit, or when the treatment is not known: never guess.
   */
  deposit?: { amount: number; treatment: 'applied' | 'held'; paidOn?: string | null } | null
  /** True for an invoice covering extra charges agreed after the main invoice. */
  additionalCharges?: boolean
}

/**
 * A private hire customer's invoice. They booked a party at the pub and have only ever dealt
 * with The Anchor, so the email names the booking: without that it is a request for money
 * from a person and a company they have never heard of.
 */
export function buildPrivateHireInvoiceEmail(input: PrivateHireInvoiceEmailInput): InvoiceEmailDraft {
  const eventDay = input.eventDate ? formatInvoiceDate(input.eventDate) : null
  const eventDayWithYear = input.eventDate ? formatInvoiceDate(input.eventDate, { withYear: true }) : null
  const reference = input.reference?.trim()

  const opening = input.additionalCharges
    ? `Here's the invoice for the extras we agreed for your booking at The Anchor${eventDayWithYear ? ` on ${eventDayWithYear}` : ''}. It covers those additional charges only, and your original invoice remains separate.`
    : `Thanks again for booking with us at The Anchor. Your invoice${eventDayWithYear ? ` for ${eventDayWithYear}` : ''} is attached.`

  const figures = [
    figuresBlock(input) ?? `Balance due: ${formatInvoiceMoney(Math.max(0, input.balance))}`,
    `Due date: ${formatInvoiceDate(input.dueDate, { withYear: true })}`,
    reference ? `Reference: ${reference}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  let depositLine: string | null = null
  if (input.deposit && input.deposit.amount > 0) {
    const received = input.deposit.paidOn ? ` received on ${formatInvoiceDate(input.deposit.paidOn, { withYear: true })}` : ''
    depositLine =
      input.deposit.treatment === 'applied'
        ? `Your deposit of ${formatInvoiceMoney(input.deposit.amount)}${received} has been applied to this invoice.`
        : `Your booking and damage deposit of ${formatInvoiceMoney(input.deposit.amount)}${received} is held separately and will be refunded within 48 hours after your event, less any documented deductions. It is not part of the amounts above.`
  }

  return {
    subject: `Invoice ${input.invoiceNumber} for your booking at The Anchor${eventDay ? ` on ${eventDay}` : ''}`,
    body: assemble([
      invoiceGreeting(input.firstName),
      opening,
      figures,
      depositLine,
      `${BANK_LINE} If anything looks wrong, just reply to this email and I'll sort it out.`,
    ]),
  }
}

export interface ReminderEmailInput {
  firstName?: string | null
  invoiceNumber: string
  balance: number
  /** What has already been received against the invoice. Thanked, never ignored. */
  paid?: number
  dueDate: string
}

/** First automatic reminder, 5 to 13 days overdue. */
export function buildFirstReminderEmail(input: ReminderEmailInput): InvoiceEmailDraft {
  const paid = Number(input.paid) || 0
  return {
    subject: `Invoice ${input.invoiceNumber}: a quick reminder`,
    body: assemble([
      invoiceGreeting(input.firstName),
      `Just a quick nudge on invoice ${input.invoiceNumber}: ${formatInvoiceMoney(input.balance)} was due on ${formatInvoiceDate(input.dueDate)}. I've attached another copy in case the first one got buried.`,
      paid > 0
        ? `Thank you for the ${formatInvoiceMoney(paid)} already received. The ${formatInvoiceMoney(input.balance)} is what's left.`
        : null,
      "If it's already on its way, please ignore this.",
    ]),
  }
}

/** Second and last automatic reminder, 14 to 20 days overdue. After this the owner takes over. */
export function buildSecondReminderEmail(input: ReminderEmailInput): InvoiceEmailDraft {
  return {
    subject: `Invoice ${input.invoiceNumber}: still outstanding`,
    body: assemble([
      invoiceGreeting(input.firstName),
      `Invoice ${input.invoiceNumber} still shows ${formatInvoiceMoney(input.balance)} to pay (it was due on ${formatInvoiceDate(input.dueDate)}). Could you let me know when it's likely to be paid, or if something on the invoice needs putting right?`,
      "If you've already paid, sorry, just let me know and I'll check.",
    ]),
  }
}

export interface ChaseEmailInput {
  firstName?: string | null
  invoiceNumber: string
  balance: number
  credits?: number
  dueDate: string
  daysOverdue: number
  /** Set for a private hire invoice, so the customer can place it. */
  bookingAtTheAnchorOn?: string | null
}

/** The chase the owner sends by hand from the invoice page. Editable before it goes. */
export function buildChaseEmail(input: ChaseEmailInput): InvoiceEmailDraft {
  const days = Math.max(0, Math.round(input.daysOverdue))
  const dayWord = days === 1 ? 'day' : 'days'
  const credits = Number(input.credits) || 0
  const booking = input.bookingAtTheAnchorOn
    ? ` for your booking at The Anchor on ${formatInvoiceDate(input.bookingAtTheAnchorOn, { withYear: true })}`
    : ''

  return {
    subject: `Gentle reminder: Invoice ${input.invoiceNumber} - ${days} ${dayWord} overdue`,
    body: assemble([
      invoiceGreeting(input.firstName),
      "I hope you're well.",
      `Just a gentle reminder that invoice ${input.invoiceNumber}${booking} was due on ${formatInvoiceDate(input.dueDate)} and is now ${days} ${dayWord} overdue. I've attached a copy for reference.`,
      [
        credits > 0 ? `Credits applied: ${formatInvoiceMoney(credits)}` : null,
        `Amount outstanding: ${formatInvoiceMoney(input.balance)}`,
      ]
        .filter(Boolean)
        .join('\n'),
      "I understand things can get busy, so this is just a friendly nudge. If there's anything I can help with, or you'd like to talk about how to pay, just reply to this email or give me a ring.",
    ]),
  }
}

export interface ReceiptEmailInput {
  firstName?: string | null
  invoiceNumber: string
  /** The payment this receipt is for. */
  paymentAmount: number
  /** What is still to pay after it. Zero or less means settled. */
  balance: number
}

/** Sent when a payment is recorded, by hand or by PayPal. Never carries a pay link. */
export function buildReceiptEmail(input: ReceiptEmailInput): InvoiceEmailDraft {
  const outcome =
    input.balance > 0
      ? `That leaves ${formatInvoiceMoney(input.balance)} still to pay.`
      : 'That settles the invoice in full.'
  return {
    subject: `Payment received for invoice ${input.invoiceNumber}`,
    body: assemble([
      invoiceGreeting(input.firstName),
      `I've received your payment of ${formatInvoiceMoney(input.paymentAmount)} for invoice ${input.invoiceNumber}, thank you. ${outcome} A receipt is attached for your records.`,
    ]),
  }
}
