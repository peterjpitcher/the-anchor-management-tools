'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildWorkRecord, type WorkRecord } from '@/lib/oj-projects/work-record'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  buildInvoiceForecast,
  nextInvoiceDate,
  type AccountPosition,
  type InvoiceForecast,
} from '@/lib/oj-projects/account-position'
import { loadAccountPosition, type NotYetInvoicedCharge } from '@/lib/oj-projects/account-position-loader'

/**
 * Where the account stands today, for the summary, the not-yet-invoiced total
 * and the forecast of invoices to come.
 */
export interface WorkRecordAccount {
  /** London calendar date the figures are true for. */
  asAt: string
  position: AccountPosition
  notYetInvoicedCharges: NotYetInvoicedCharge[]
  /** Null for a client who is invoiced in full each month: there is no plan to show. */
  forecast: InvoiceForecast | null
  monthlyChargesIncVat: number
}

export interface WorkRecordData {
  vendor: { id: string; name: string }
  period: { from: string; to: string }
  record: WorkRecord
  monthlyCapIncVat: number | null
  /**
   * Only present when the record runs up to today. The position cannot be
   * rebuilt for a past date, and today's figures beside an older period would
   * not agree with the work listed.
   */
  account?: WorkRecordAccount
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * The data behind the client Work Record.
 *
 * Entries are selected by their own date, and the invoices they reference are
 * loaded regardless of the invoice's date. Under a monthly cap the invoice that
 * charged a piece of work is usually raised in a later month than the work, so
 * scoping invoices by the period would leave entries pointing at nothing.
 */
export async function getWorkRecord(
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ data?: WorkRecordData; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }

  if (!vendorId || !dateFrom || !dateTo) return { error: 'Missing required parameters' }
  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) {
    return { error: 'Dates must be real calendar dates in YYYY-MM-DD format' }
  }
  if (dateFrom > dateTo) return { error: 'Date range is invalid: dateFrom must be before dateTo' }

  const supabase = await createClient()

  const { data: vendor, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id, name')
    .eq('id', vendorId)
    .single()

  if (vendorError || !vendor) return { error: vendorError?.message || 'Client not found' }

  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(`
      id, entry_date, entry_type, description, duration_minutes_rounded, miles,
      amount_ex_vat_snapshot, hourly_rate_ex_vat_snapshot, mileage_rate_snapshot,
      vat_rate_snapshot, billable, status, invoice_id, split_from_entry_id,
      work_type_name_snapshot,
      project:oj_projects(project_code, project_name)
    `)
    .eq('vendor_id', vendorId)
    .gte('entry_date', dateFrom)
    .lte('entry_date', dateTo)
    .order('entry_date', { ascending: true })
    .limit(10000)

  if (entriesError) return { error: entriesError.message }

  const referencedInvoiceIds = new Set(
    (entries || []).map((e) => e.invoice_id).filter(Boolean) as string[]
  )

  const [invoicesResult, recurringResult, settingsResult] = await Promise.all([
    supabase
      .from('invoices')
      // The client's whole invoice ledger, not just the invoices entries happen
      // to point at. Deriving the list from entries hid INV-003VM, a paid GBP 500
      // invoice with no work linked to it, from this document for months while
      // the account statement showed it: the two disagreed by GBP 500.
      .select('id, invoice_number, invoice_date, status, subtotal_amount, total_amount, paid_amount, reference, is_fixed_price')
      .eq('vendor_id', vendorId)
      .is('deleted_at', null)
      // Void invoices are excluded, as on the account statement. Their work
      // has moved to the reissue, so including both shows it twice.
      .not('status', 'in', '("void","written_off","draft")')
      .order('invoice_date', { ascending: true }),
    supabase
      .from('oj_recurring_charge_instances')
      .select('invoice_id, description_snapshot, amount_ex_vat_snapshot, vat_rate_snapshot')
      .eq('vendor_id', vendorId),
    supabase
      .from('oj_vendor_billing_settings')
      .select('hourly_rate_ex_vat, mileage_rate, vat_rate, billing_mode, monthly_cap_inc_vat, statement_mode')
      .eq('vendor_id', vendorId)
      .maybeSingle(),
  ])

  if (invoicesResult.error) return { error: invoicesResult.error.message }
  if (recurringResult.error) return { error: recurringResult.error.message }

  const settings = settingsResult.data
  // An invoice belongs in the document when it falls in the period the client
  // asked about, or when in-period work was charged on it. The second case
  // matters under a monthly cap, where the invoice is raised months after the
  // work and would otherwise fall outside the window.
  const invoices = (invoicesResult.data || []).filter(
    (i) =>
      referencedInvoiceIds.has(i.id) ||
      (typeof i.invoice_date === 'string' && i.invoice_date >= dateFrom && i.invoice_date <= dateTo)
  )
  const liveInvoiceIds = new Set(invoices.map((i) => i.id))

  const record = buildWorkRecord({
    // An entry pointing at a void or excluded invoice is treated as unlinked, so
    // it surfaces honestly rather than vanishing from every section.
    entries: (entries || []).map((e: any) => ({
      ...e,
      invoice_id: e.invoice_id && liveInvoiceIds.has(e.invoice_id) ? e.invoice_id : null,
      project: Array.isArray(e.project) ? e.project[0] : e.project,
    })),
    recurring: recurringResult.data || [],
    invoices,
    settings,
  })

  const monthlyCapIncVat =
    settings?.billing_mode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number'
      ? settings.monthly_cap_inc_vat
      : null

  let account: WorkRecordAccount | undefined
  const today = getTodayIsoDate()
  if (dateTo >= today) {
    const loaded = await loadAccountPosition(supabase, vendorId)
    // Fails closed. Without the position the document would list unpaid
    // invoices and unbilled work with no total, which is the gap it exists to close.
    if (loaded.error || !loaded.data) {
      return { error: loaded.error || 'Could not load the account position' }
    }
    account = {
      asAt: today,
      position: loaded.data.position,
      notYetInvoicedCharges: loaded.data.notYetInvoicedCharges,
      monthlyChargesIncVat: loaded.data.monthlyChargesIncVat,
      forecast:
        monthlyCapIncVat && monthlyCapIncVat > 0
          ? buildInvoiceForecast({
              startingBalance: loaded.data.position.notYetInvoicedNet,
              monthlyCapIncVat,
              monthlyChargesIncVat: loaded.data.monthlyChargesIncVat,
              firstInvoiceDate: nextInvoiceDate(today),
            })
          : null,
    }
  }

  return {
    data: {
      vendor: { id: vendor.id, name: vendor.name },
      period: { from: dateFrom, to: dateTo },
      record,
      monthlyCapIncVat,
      account,
    },
  }
}
