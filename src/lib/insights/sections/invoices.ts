import { fetchAllRows } from '@/lib/supabase/paged-read'
import { formatDateWithYear, formatDayDate, formatMoney, plural } from '../format'
import { mergeSignals } from '../signals'
import { INVOICES } from '../thresholds'
import { daysBetween, isInRange } from '../windows'
import type {
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.12.
//
// Scope: invoices not deleted, status sent, partially_paid or overdue, with a balance above
// zero. Overdue means the due date is before today, whatever the status column says, because
// the status only changes when the reminder cron runs. Customer (vendor) names are email safe
// (decision 13: the reader acts on the customer).
//
// An overdue invoice for a private booking that Private hire still checks (event today or
// later, not cancelled) is chased there, on the booking (spec 5.6). Actions are only
// de-duplicated within a section, so this section keeps that invoice's facts but leaves its
// action to Private hire: one primary action per record (spec 4.5).

type InvoiceLabel = 'OJ Projects' | 'private hire'

interface VendorEmbed {
  name: string | null
}

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  due_date: string
  total_amount: number | string | null
  paid_amount: number | string | null
  sent_at: string | null
  vendor: VendorEmbed | VendorEmbed[] | null
}

interface LinkRow {
  id: string
  invoice_id: string | null
  /** Private bookings only. */
  event_date?: string | null
  status?: string | null
}

interface OpenInvoice {
  id: string
  number: string
  status: string
  customer: string | null
  outstanding: number
  dueDate: string
  /** Whole days past the due date; 0 when not yet overdue. */
  daysOverdue: number
  emailed: boolean
  labels: InvoiceLabel[]
  /** Event date of the linked private booking that Private hire still checks, if any. */
  privateHireEvent: string | null
}

interface InvoiceLinks {
  labels: Map<string, InvoiceLabel[]>
  /** Invoice id to the earliest event date of a linked booking that Private hire checks. */
  privateHireEvents: Map<string, string>
}

/** Tables whose invoice_id marks where an invoice came from (checked live, 18 Sep 2026). */
const LINK_SOURCES: ReadonlyArray<{ table: string; label: InvoiceLabel }> = [
  { table: 'private_bookings', label: 'private hire' },
  { table: 'oj_billing_runs', label: 'OJ Projects' },
  { table: 'oj_entries', label: 'OJ Projects' },
  { table: 'oj_recurring_charge_instances', label: 'OJ Projects' },
]

const LABEL_ORDER: InvoiceLabel[] = ['OJ Projects', 'private hire']

function toAmount(value: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : null
}

function vendorName(vendor: InvoiceRow['vendor']): string | null {
  const embedded = Array.isArray(vendor) ? vendor[0] : vendor
  const name = embedded?.name?.trim()
  return name ? name : null
}

/** Pounds when the amount is whole, pence otherwise, so a chase quotes the exact balance. */
function money(amount: number): string {
  const pence = Math.round(amount * 100)
  return formatMoney(pence / 100, { pence: pence % 100 !== 0 })
}

function dueText(isoDate: string, today: string): string {
  return Math.abs(daysBetween(today, isoDate)) > 180 ? formatDateWithYear(isoDate) : formatDayDate(isoDate)
}

/** "INV-0012 (Acme Ltd)". */
function reference(invoice: OpenInvoice): string {
  return invoice.customer ? `${invoice.number} (${invoice.customer})` : invoice.number
}

/** "INV-0012 (Acme Ltd, OJ Projects)". */
function describe(invoice: OpenInvoice): string {
  const parts = [invoice.customer, ...invoice.labels].filter((part): part is string => Boolean(part))
  return parts.length ? `${invoice.number} (${parts.join(', ')})` : invoice.number
}

/** The narrowest invoice list that shows every one of these overdue invoices. */
function overdueListPath(invoices: OpenInvoice[]): string {
  // /invoices?status=overdue lists status 'overdue' plus 'sent' past its due date; a
  // partially paid invoice past due only appears in the wider unpaid list.
  const allInOverdueList = invoices.every((invoice) => invoice.status === 'overdue' || invoice.status === 'sent')
  return allInOverdueList ? '/invoices?status=overdue' : '/invoices?status=unpaid'
}

async function readOpenInvoiceRows(ctx: SectionContext): Promise<InvoiceRow[]> {
  return fetchAllRows<InvoiceRow>(
    (from, to) => ctx.db
      .from('invoices')
      .select('id, invoice_number, status, due_date, total_amount, paid_amount, sent_at, vendor:invoice_vendors(name)')
      .is('deleted_at', null)
      .in('status', [...INVOICES.openStatuses])
      .order('id')
      .range(from, to),
    { label: 'insights invoices' },
  )
}

async function readLinkRows(ctx: SectionContext, table: string, invoiceIds: string[]): Promise<LinkRow[]> {
  const linked: LinkRow[] = []
  for (let start = 0; start < invoiceIds.length; start += INVOICES.linkLookupChunk) {
    const chunk = invoiceIds.slice(start, start + INVOICES.linkLookupChunk)
    const rows = await fetchAllRows<LinkRow>(
      // Private bookings also carry the event date and status Private hire scopes by.
      (from, to) => table === 'private_bookings'
        ? ctx.db.from(table).select('id, invoice_id, event_date, status').in('invoice_id', chunk).order('id').range(from, to)
        : ctx.db.from(table).select('id, invoice_id').in('invoice_id', chunk).order('id').range(from, to),
      { label: `insights invoice links (${table})` },
    )
    linked.push(...rows)
  }
  return linked
}

/**
 * Mirrors the Private hire read (spec 5.6): a booking dated today or later and not cancelled.
 * PostgREST's neq also drops a null status, so a booking with no status is not checked there.
 */
function checkedByPrivateHire(row: LinkRow, today: string): string | null {
  const eventDate = row.event_date ? String(row.event_date).slice(0, 10) : null
  if (!eventDate || eventDate < today) return null
  if (!row.status || row.status === 'cancelled') return null
  return eventDate
}

async function readLinks(ctx: SectionContext, invoiceIds: string[]): Promise<InvoiceLinks> {
  const labels = new Map<string, InvoiceLabel[]>()
  const privateHireEvents = new Map<string, string>()
  if (invoiceIds.length === 0) return { labels, privateHireEvents }
  const linked = await Promise.all(LINK_SOURCES.map((source) => readLinkRows(ctx, source.table, invoiceIds)))
  LINK_SOURCES.forEach((source, index) => {
    for (const row of linked[index]) {
      if (!row.invoice_id) continue
      const current = labels.get(row.invoice_id) ?? []
      if (!current.includes(source.label)) current.push(source.label)
      labels.set(row.invoice_id, current)
      if (source.table !== 'private_bookings') continue
      const eventDate = checkedByPrivateHire(row, ctx.windows.today)
      const held = privateHireEvents.get(row.invoice_id)
      if (eventDate && (!held || eventDate < held)) privateHireEvents.set(row.invoice_id, eventDate)
    }
  })
  for (const [id, current] of labels) {
    labels.set(id, LABEL_ORDER.filter((label) => current.includes(label)))
  }
  return { labels, privateHireEvents }
}

function overdueSignal(ctx: SectionContext, invoice: OpenInvoice): InsightSignal {
  const red = invoice.daysOverdue >= INVOICES.redOverdueDays
  const days = plural(invoice.daysOverdue, 'day')
  const actionText = invoice.emailed
    ? `Chase ${reference(invoice)}, ${money(invoice.outstanding)}, ${days} overdue`
    : `Send ${reference(invoice)}, ${money(invoice.outstanding)}, ${days} overdue and never emailed`
  return {
    key: `invoices.${red ? 'overdue_30' : 'overdue'}.${invoice.id}`,
    entity: `invoice:${invoice.id}`,
    rag: red ? 'red' : 'amber',
    kind: 'issue',
    text: `${describe(invoice)} is ${days} overdue, ${money(invoice.outstanding)} outstanding.`,
    emailSafe: true,
    action: {
      text: actionText,
      href: ctx.link(`/invoices/${invoice.id}`),
      target: 'record',
      dueDate: invoice.dueDate,
      impact: 'money',
    },
  }
}

/**
 * An overdue invoice whose chase Private hire carries on the booking: the same fact and
 * status as any other overdue invoice here, with no action of its own.
 */
function handedToPrivateHireSignal(ctx: SectionContext, invoice: OpenInvoice, eventDate: string): InsightSignal {
  const { action: _chasedInPrivateHire, ...signal } = overdueSignal(ctx, invoice)
  return {
    ...signal,
    text: `${signal.text} The chase is listed under Private hire, ahead of the event on ${dueText(eventDate, ctx.windows.today)}.`,
  }
}

function neverEmailedSignal(ctx: SectionContext, invoice: OpenInvoice, withAction: boolean): InsightSignal {
  const signal: InsightSignal = {
    key: `invoices.never_emailed.${invoice.id}`,
    entity: `invoice:${invoice.id}`,
    rag: 'amber',
    kind: 'issue',
    text: `The reminder system will never chase ${invoice.number} (${[invoice.customer, money(invoice.outstanding), `due ${dueText(invoice.dueDate, ctx.windows.today)}`].filter(Boolean).join(', ')}) because it was not emailed.`,
    emailSafe: true,
  }
  if (!withAction) return signal
  return {
    ...signal,
    action: {
      text: `Send ${reference(invoice)} to the customer, ${money(invoice.outstanding)}`,
      href: ctx.link(`/invoices/${invoice.id}`),
      target: 'record',
      dueDate: invoice.dueDate,
      impact: 'money',
    },
  }
}

function listItem(ctx: SectionContext, invoice: OpenInvoice): InsightListItem {
  const when = invoice.daysOverdue > 0
    ? `${plural(invoice.daysOverdue, 'day')} overdue (due ${dueText(invoice.dueDate, ctx.windows.today)})`
    : `due ${dueText(invoice.dueDate, ctx.windows.today)}`
  const tail = invoice.emailed ? '' : ' Never emailed.'
  const rag = invoice.daysOverdue >= INVOICES.redOverdueDays
    ? 'red'
    : invoice.daysOverdue > 0 || !invoice.emailed ? 'amber' : undefined
  return {
    text: `${describe(invoice)}: ${money(invoice.outstanding)} outstanding, ${when}.${tail}`,
    href: ctx.link(`/invoices/${invoice.id}`),
    ...(rag ? { rag } : {}),
  }
}

function sum(invoices: OpenInvoice[]): number {
  return invoices.reduce((total, invoice) => total + invoice.outstanding, 0)
}

export async function buildInvoicesSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { today, thisWeek } = ctx.windows
  const rows = await readOpenInvoiceRows(ctx)

  const notes: string[] = []
  const withoutTotal = rows.filter((row) => toAmount(row.total_amount) === null)
  if (withoutTotal.length > 0) {
    notes.push(`${plural(withoutTotal.length, 'open invoice')} ${withoutTotal.length === 1 ? 'has' : 'have'} no total recorded, so ${withoutTotal.length === 1 ? 'it is' : 'they are'} left out of these figures.`)
  }

  const candidates = rows.flatMap((row) => {
    const total = toAmount(row.total_amount)
    if (total === null) return []
    const outstanding = Math.round((total - (toAmount(row.paid_amount) ?? 0)) * 100) / 100
    if (outstanding <= 0) return []
    const dueDate = String(row.due_date).slice(0, 10)
    return [{ row, outstanding, dueDate }]
  })

  const { labels, privateHireEvents } = await readLinks(ctx, candidates.map(({ row }) => row.id))

  const open: OpenInvoice[] = candidates.map(({ row, outstanding, dueDate }) => ({
    id: row.id,
    number: row.invoice_number,
    status: row.status,
    customer: vendorName(row.vendor),
    outstanding,
    dueDate,
    daysOverdue: dueDate < today ? daysBetween(dueDate, today) : 0,
    emailed: Boolean(row.sent_at),
    labels: labels.get(row.id) ?? [],
    privateHireEvent: privateHireEvents.get(row.id) ?? null,
  }))

  const overdue = open
    .filter((invoice) => invoice.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.number.localeCompare(b.number))
  const notYetDue = open
    .filter((invoice) => invoice.daysOverdue === 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number))
  const neverEmailed = [...overdue, ...notYetDue].filter((invoice) => !invoice.emailed)
  const newlyOverdue = overdue.filter((invoice) => isInRange(invoice.dueDate, thisWeek))
  const oldest = overdue[0]
  const overdueTotal = sum(overdue)
  const openTotal = sum(open)

  // Private hire chases an overdue invoice for a booking it still checks, so this section
  // chases only the rest; those it hands over keep their line with no action.
  const toChase = overdue.filter((invoice) => !invoice.privateHireEvent)
  const handedOver = overdue.flatMap((invoice) => (invoice.privateHireEvent ? [{ invoice, eventDate: invoice.privateHireEvent }] : []))
  const redToChase = toChase.filter((invoice) => invoice.daysOverdue >= INVOICES.redOverdueDays)
  const toChaseTotal = sum(toChase)

  // Signals, in the order of the spec's signal table so ties between rules for one invoice
  // keep the overdue action (spec 4.5): overdue 30 days or more, other overdue, never emailed.
  const overdueSignals = toChase.map((invoice) => overdueSignal(ctx, invoice))
  const merged = toChase.length > INVOICES.mergeAbove
  const chaseSignals = mergeSignals(overdueSignals, {
    above: INVOICES.mergeAbove,
    key: 'invoices.chase_overdue',
    rag: redToChase.length > 0 ? 'red' : 'amber',
    text: (count) => {
      const serious = redToChase.length > 0
        ? `${plural(redToChase.length, 'invoice')} by ${INVOICES.redOverdueDays} days or more, `
        : ''
      // "other" when some overdue invoices are shown separately, under Private hire's chase.
      const which = plural(count, handedOver.length > 0 ? 'other invoice' : 'invoice')
      return `${which} are overdue, ${money(toChaseTotal)} in total; ${serious}the oldest ${plural(toChase[0]?.daysOverdue ?? 0, 'day')} overdue.`
    },
    action: {
      text: `Chase ${plural(toChase.length, 'overdue invoice')}, ${money(toChaseTotal)} in total`,
      href: ctx.link(overdueListPath(toChase)),
      impact: 'money',
    },
  })
  const handedOverSignals = handedOver.map(({ invoice, eventDate }) => handedToPrivateHireSignal(ctx, invoice, eventDate))
  // An overdue invoice that was never emailed keeps its line but not a second action when its
  // chase is merged into the list action or carried by Private hire, so each record still has
  // one primary action.
  const emailSignals = neverEmailed.map((invoice) => neverEmailedSignal(
    ctx,
    invoice,
    !(invoice.daysOverdue > 0 && (merged || invoice.privateHireEvent !== null)),
  ))
  const signals = [...chaseSignals, ...handedOverSignals, ...emailSignals]

  const metrics: InsightMetric[] = [
    {
      label: 'Outstanding',
      value: money(openTotal),
      comparison: open.length ? plural(open.length, 'open invoice') : 'no open invoices',
    },
    {
      label: 'Overdue',
      value: money(overdueTotal),
      comparison: overdue.length ? plural(overdue.length, 'invoice') : 'no overdue invoices',
    },
    oldest
      ? { label: 'Oldest overdue', value: plural(oldest.daysOverdue, 'day'), comparison: reference(oldest) }
      : { label: 'Oldest overdue', value: 'None' },
    {
      label: 'Never emailed',
      value: String(neverEmailed.length),
      ...(neverEmailed.length ? { comparison: `${money(sum(neverEmailed))} outstanding` } : {}),
    },
    {
      label: 'Newly overdue this week',
      value: String(newlyOverdue.length),
      comparison: newlyOverdue.length
        ? `${money(sum(newlyOverdue))}, due ${formatDayDate(thisWeek.start)} to ${formatDayDate(thisWeek.end)}`
        : `none fell due ${formatDayDate(thisWeek.start)} to ${formatDayDate(thisWeek.end)}`,
    },
  ]
  for (const label of LABEL_ORDER) {
    const labelled = open.filter((invoice) => invoice.labels.includes(label))
    if (labelled.length === 0) continue
    metrics.push({
      label: label === 'OJ Projects' ? 'OJ Projects outstanding' : 'Private hire outstanding',
      value: money(sum(labelled)),
      comparison: plural(labelled.length, 'invoice'),
    })
  }

  const lists: InsightList[] = [
    { title: 'Overdue invoices', items: overdue.map((invoice) => listItem(ctx, invoice)), emptyText: 'No overdue invoices.' },
    { title: 'Open invoices not yet due', items: notYetDue.map((invoice) => listItem(ctx, invoice)) },
  ]

  let headline: string
  if (open.length === 0) {
    headline = 'No open invoices.'
  } else {
    const parts = [`${plural(open.length, 'open invoice')}, ${money(openTotal)} outstanding.`]
    parts.push(overdue.length
      ? `${overdue.length} overdue (${money(overdueTotal)}), oldest ${plural(oldest?.daysOverdue ?? 0, 'day')}.`
      : 'None overdue.')
    if (neverEmailed.length) parts.push(`${neverEmailed.length} never emailed.`)
    headline = parts.join(' ')
  }

  return { headline, metrics, lists, signals, notes }
}

export const invoicesSection: SectionDefinition = {
  key: 'invoices',
  title: 'Invoices',
  path: '/invoices',
  build: buildInvoicesSection,
}
