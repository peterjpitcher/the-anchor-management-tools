'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildWorkRecord, type WorkRecord } from '@/lib/oj-projects/work-record'

export interface WorkRecordData {
  vendor: { id: string; name: string }
  period: { from: string; to: string }
  record: WorkRecord
  monthlyCapIncVat: number | null
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

  const invoiceIds = Array.from(
    new Set((entries || []).map((e) => e.invoice_id).filter(Boolean) as string[])
  )

  const [invoicesResult, recurringResult, settingsResult] = await Promise.all([
    invoiceIds.length
      ? supabase
          .from('invoices')
          .select('id, invoice_number, invoice_date, status, total_amount, is_fixed_price')
          .in('id', invoiceIds)
          .is('deleted_at', null)
          // Void invoices are excluded, as on the account statement. Their work
          // has moved to the reissue, so including both shows it twice.
          .not('status', 'in', '("void","written_off","draft")')
          .order('invoice_date', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? supabase
          .from('oj_recurring_charge_instances')
          .select('invoice_id, description_snapshot, amount_ex_vat_snapshot, vat_rate_snapshot')
          .in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('oj_vendor_billing_settings')
      .select('hourly_rate_ex_vat, mileage_rate, vat_rate, billing_mode, monthly_cap_inc_vat, statement_mode')
      .eq('vendor_id', vendorId)
      .maybeSingle(),
  ])

  if (invoicesResult.error) return { error: invoicesResult.error.message }
  if (recurringResult.error) return { error: recurringResult.error.message }

  const settings = settingsResult.data
  const invoices = invoicesResult.data || []
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

  return {
    data: {
      vendor: { id: vendor.id, name: vendor.name },
      period: { from: dateFrom, to: dateTo },
      record,
      monthlyCapIncVat:
        settings?.billing_mode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number'
          ? settings.monthly_cap_inc_vat
          : null,
    },
  }
}
