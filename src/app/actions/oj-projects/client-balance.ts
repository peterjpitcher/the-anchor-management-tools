'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

function roundMoney(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export type ClientInvoiceSummary = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  reference: string
  status: string
  total_amount: number
  paid_amount: number
  outstanding: number
}

export type ClientBalance = {
  unpaidInvoiceBalance: number
  unbilledTimeTotal: number
  unbilledMileageTotal: number
  unbilledRecurringTotal: number
  unbilledTotal: number
  totalOutstanding: number
  invoices: ClientInvoiceSummary[]
}

export async function getClientBalance(
  vendorId: string
): Promise<{ balance?: ClientBalance; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }

  const supabase = await createClient()

  // Fetch all OJ Projects invoices for this vendor (most recent first, up to 50)
  const { data: invoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, reference, status, total_amount, paid_amount')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .ilike('reference', 'OJ Projects %')
    .order('invoice_date', { ascending: false })
    .limit(50)

  if (invoicesError) return { error: invoicesError.message }

  // Unpaid invoice balance: sum of (total - paid) for non-settled invoices
  const unpaidInvoiceBalance = roundMoney(
    (invoices || [])
      .filter((inv) => !['paid', 'void', 'written_off'].includes(inv.status))
      .reduce((acc, inv) => {
        const total = Number(inv.total_amount || 0)
        const paid = Number(inv.paid_amount || 0)
        return acc + Math.max(total - paid, 0)
      }, 0)
  )

  // Unbilled entries: use the rate snapshots stored at entry creation time
  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(
      'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot'
    )
    .eq('vendor_id', vendorId)
    .eq('status', 'unbilled')
    .eq('billable', true)

  if (entriesError) return { error: entriesError.message }

  let unbilledTimeTotal = 0
  let unbilledMileageTotal = 0
  for (const entry of entries || []) {
    if (entry.entry_type === 'time') {
      const mins = Number(entry.duration_minutes_rounded || 0)
      const rate = Number(entry.hourly_rate_ex_vat_snapshot || 75)
      const vat = Number(entry.vat_rate_snapshot || 20)
      unbilledTimeTotal = roundMoney(unbilledTimeTotal + (mins / 60) * rate * (1 + vat / 100))
    } else if (entry.entry_type === 'mileage') {
      const miles = Number(entry.miles || 0)
      const mileageRate = Number(entry.mileage_rate_snapshot || 0.42)
      unbilledMileageTotal = roundMoney(unbilledMileageTotal + miles * mileageRate)
    }
  }

  // Unbilled recurring charge instances
  const { data: instances, error: instancesError } = await supabase
    .from('oj_recurring_charge_instances')
    .select('amount_ex_vat_snapshot, vat_rate_snapshot')
    .eq('vendor_id', vendorId)
    .eq('status', 'unbilled')

  if (instancesError) return { error: instancesError.message }

  const unbilledRecurringTotal = roundMoney(
    (instances || []).reduce((acc, inst) => {
      const exVat = Number(inst.amount_ex_vat_snapshot || 0)
      const vat = Number(inst.vat_rate_snapshot || 0)
      return acc + exVat * (1 + vat / 100)
    }, 0)
  )

  const unbilledTotal = roundMoney(unbilledTimeTotal + unbilledMileageTotal + unbilledRecurringTotal)
  const totalOutstanding = roundMoney(unpaidInvoiceBalance + unbilledTotal)

  const invoiceSummaries: ClientInvoiceSummary[] = (invoices || []).map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    reference: inv.reference || '',
    status: inv.status,
    total_amount: Number(inv.total_amount || 0),
    paid_amount: Number(inv.paid_amount || 0),
    outstanding: Math.max(Number(inv.total_amount || 0) - Number(inv.paid_amount || 0), 0),
  }))

  return {
    balance: {
      unpaidInvoiceBalance,
      unbilledTimeTotal,
      unbilledMileageTotal,
      unbilledRecurringTotal,
      unbilledTotal,
      totalOutstanding,
      invoices: invoiceSummaries,
    },
  }
}
