import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { buildCsvBuffer, escapeCsvCell } from '@/lib/receipts/export/csv-helpers'

/**
 * Money taken online (BK-117, customer bookings review of 24 October 2026; owner decision D33).
 *
 * One row per online payment, read from the view online_income_movements (migration
 * 20261026234203), which takes each kind of payment from where it is really recorded: table and
 * private-hire deposits from the booking, tickets from the payments ledger, invoices and parking
 * from their own tables. Door money recorded by hand is in the till already and is not here.
 *
 * Online booking money is its own line in the P&L and is kept off the till (D33): ringing it
 * through the till as well counts it twice.
 */

export type OnlineIncomeSource =
  | 'table_deposit'
  | 'private_hire_deposit'
  | 'event_ticket'
  | 'invoice'
  | 'parking'

export type OnlineIncomeStatus =
  | 'held'
  | 'applied'
  | 'kept'
  | 'earned'
  | 'paid'
  | 'refunded'
  | 'part_refunded'

export type OnlineIncomeRow = {
  source: OnlineIncomeSource
  sourceId: string
  moneyDate: string
  reference: string | null
  visitDate: string | null
  gross: number
  refunded: number
  net: number
  method: string
  captureId: string | null
  paypalFee: number | null
  status: OnlineIncomeStatus
  isBookingMoney: boolean
}

export const ONLINE_INCOME_SOURCE_LABELS: Record<OnlineIncomeSource, string> = {
  table_deposit: 'Table deposit',
  private_hire_deposit: 'Private hire deposit',
  event_ticket: 'Event tickets',
  invoice: 'Invoice paid online',
  parking: 'Parking',
}

export const ONLINE_INCOME_STATUS_LABELS: Record<OnlineIncomeStatus, string> = {
  held: 'Held (visit to come)',
  applied: 'Applied to the bill',
  kept: 'Kept (cancelled or no-show)',
  earned: 'Earned (night has passed)',
  paid: 'Paid',
  refunded: 'Refunded',
  part_refunded: 'Part refunded',
}

type ViewRow = {
  source: string | null
  source_id: string | null
  money_date: string | null
  booking_reference: string | null
  visit_date: string | null
  gross: number | string | null
  refunded: number | string | null
  net: number | string | null
  method: string | null
  capture_id: string | null
  paypal_fee: number | string | null
  status: string | null
  is_booking_money: boolean | null
}

const PAGE_SIZE = 1000

function money(value: number | string | null): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

function mapRow(row: ViewRow): OnlineIncomeRow {
  return {
    source: (row.source ?? 'invoice') as OnlineIncomeSource,
    sourceId: row.source_id ?? '',
    moneyDate: row.money_date ?? '',
    reference: row.booking_reference,
    visitDate: row.visit_date,
    gross: money(row.gross),
    refunded: money(row.refunded),
    net: money(row.net),
    method: row.method ?? 'paypal',
    captureId: row.capture_id,
    paypalFee: row.paypal_fee === null || row.paypal_fee === undefined ? null : money(row.paypal_fee),
    status: (row.status ?? 'paid') as OnlineIncomeStatus,
    isBookingMoney: row.is_booking_money === true,
  }
}

/**
 * Online payments taken between two London dates, inclusive. Callers check the cash-up view
 * permission first: the view is service-role only.
 */
export async function loadOnlineIncome(range: { from: string; to: string }): Promise<OnlineIncomeRow[]> {
  const db = createAdminClient()
  const rows: OnlineIncomeRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('online_income_movements')
      .select('source, source_id, money_date, booking_reference, visit_date, gross, refunded, net, method, capture_id, paypal_fee, status, is_booking_money')
      .gte('money_date', range.from)
      .lte('money_date', range.to)
      .order('money_date', { ascending: true })
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to load online income: ${error.message}`)
    const page = (data ?? []) as ViewRow[]
    rows.push(...page.map(mapRow))
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

export type OnlineIncomeTotals = {
  count: number
  gross: number
  refunded: number
  net: number
  /** PayPal fees known for these payments (fees are recorded from October 2026). */
  paypalFees: number
  /** Payments whose PayPal fee is not recorded. */
  feesUnknown: number
}

export type OnlineIncomeSummary = {
  total: OnlineIncomeTotals
  /** Booking money net of refunds: the P&L's own line (D33). Invoices for no booking are left out. */
  bookingMoneyNet: number
  bySource: Array<{ source: OnlineIncomeSource; label: string; totals: OnlineIncomeTotals }>
  byStatus: Array<{ status: OnlineIncomeStatus; label: string; net: number; count: number }>
}

function emptyTotals(): OnlineIncomeTotals {
  return { count: 0, gross: 0, refunded: 0, net: 0, paypalFees: 0, feesUnknown: 0 }
}

function addTo(totals: OnlineIncomeTotals, row: OnlineIncomeRow): void {
  totals.count += 1
  totals.gross = money(totals.gross + row.gross)
  totals.refunded = money(totals.refunded + row.refunded)
  totals.net = money(totals.net + row.net)
  if (row.paypalFee === null) {
    if (row.method === 'paypal') totals.feesUnknown += 1
  } else {
    totals.paypalFees = money(totals.paypalFees + row.paypalFee)
  }
}

export function summariseOnlineIncome(rows: OnlineIncomeRow[]): OnlineIncomeSummary {
  const total = emptyTotals()
  const bySource = new Map<OnlineIncomeSource, OnlineIncomeTotals>()
  const byStatus = new Map<OnlineIncomeStatus, { net: number; count: number }>()
  let bookingMoneyNet = 0

  for (const row of rows) {
    addTo(total, row)
    const sourceTotals = bySource.get(row.source) ?? emptyTotals()
    addTo(sourceTotals, row)
    bySource.set(row.source, sourceTotals)
    const statusTotals = byStatus.get(row.status) ?? { net: 0, count: 0 }
    statusTotals.net = money(statusTotals.net + row.net)
    statusTotals.count += 1
    byStatus.set(row.status, statusTotals)
    if (row.isBookingMoney) bookingMoneyNet = money(bookingMoneyNet + row.net)
  }

  return {
    total,
    bookingMoneyNet,
    bySource: (Object.keys(ONLINE_INCOME_SOURCE_LABELS) as OnlineIncomeSource[])
      .filter((source) => bySource.has(source))
      .map((source) => ({ source, label: ONLINE_INCOME_SOURCE_LABELS[source], totals: bySource.get(source)! })),
    byStatus: (Object.keys(ONLINE_INCOME_STATUS_LABELS) as OnlineIncomeStatus[])
      .filter((status) => byStatus.has(status))
      .map((status) => ({ status, label: ONLINE_INCOME_STATUS_LABELS[status], ...byStatus.get(status)! })),
  }
}

function formatIsoDateDdMmYyyy(value: string | null): string {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function amount(value: number): string {
  return value.toFixed(2)
}

/** The CSV the accountant gets: one line per online payment, BOM-prefixed for Excel. */
export function buildOnlineIncomeCsv(rows: OnlineIncomeRow[]): Buffer {
  const header = [
    'Date taken',
    'Kind',
    'Reference',
    'Visit date',
    'Gross',
    'Refunded',
    'Net',
    'PayPal fee',
    'Method',
    'Status',
    'Booking money',
    'PayPal capture id',
  ]
  const lines = rows.map((row) => [
    formatIsoDateDdMmYyyy(row.moneyDate),
    ONLINE_INCOME_SOURCE_LABELS[row.source] ?? row.source,
    escapeCsvCell(row.reference ?? ''),
    formatIsoDateDdMmYyyy(row.visitDate),
    amount(row.gross),
    amount(row.refunded),
    amount(row.net),
    row.paypalFee === null ? '' : amount(row.paypalFee),
    row.method === 'stripe' ? 'Stripe' : 'PayPal',
    ONLINE_INCOME_STATUS_LABELS[row.status] ?? row.status,
    row.isBookingMoney ? 'Yes' : 'No',
    escapeCsvCell(row.captureId ?? ''),
  ])
  return buildCsvBuffer([header, ...lines])
}

/**
 * Online booking money net of refunds taken on or after each start date (London), for the P&L
 * line. One read covers every timeframe: rows from the oldest start, summed per timeframe.
 */
export async function sumOnlineBookingIncomeSince(
  db: ReturnType<typeof createAdminClient>,
  startDates: Record<string, string>
): Promise<Record<string, number>> {
  const oldest = Object.values(startDates).sort()[0]
  const totals: Record<string, number> = Object.fromEntries(Object.keys(startDates).map((key) => [key, 0]))
  if (!oldest) return totals

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('online_income_movements')
      .select('source_id, money_date, net, is_booking_money')
      .gte('money_date', oldest)
      .eq('is_booking_money', true)
      .order('money_date', { ascending: true })
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to load online booking income: ${error.message}`)
    const page = (data ?? []) as Array<{ money_date: string | null; net: number | string | null; is_booking_money: boolean | null }>
    for (const row of page) {
      if (!row.money_date || row.is_booking_money !== true) continue
      for (const [key, start] of Object.entries(startDates)) {
        if (row.money_date >= start) totals[key] = money(totals[key] + money(row.net))
      }
    }
    if (page.length < PAGE_SIZE) break
  }
  return totals
}
