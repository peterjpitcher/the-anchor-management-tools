'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { DEFAULT_HOURLY_RATE_EX_VAT, DEFAULT_MILEAGE_RATE, resolveRate } from '@/lib/oj-projects/rates'

function roundMoney(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/**
 * Unbilled work has to be reported inc VAT, because it is added to the unpaid
 * invoice balance, which is inc VAT (invoices.total_amount). Mixing the two
 * bases produced a Total Outstanding that understated the real figure by the
 * VAT on the unbilled work. This mirrors the billing engine's getEntryCharge.
 */
function moneyIncVat(exVat: number, vatRate: number) {
  const safeExVat = Number.isFinite(exVat) ? exVat : 0
  const safeVatRate = Number.isFinite(vatRate) ? vatRate : 0
  return roundMoney(safeExVat + roundMoney(safeExVat * (safeVatRate / 100)))
}

type ClientInvoiceSummary = {
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
  /**
   * Raised but never sent. Shown separately because the client has not been
   * asked to pay it, so it is not a receivable and must stay out of
   * totalOutstanding. A draft sitting here for weeks usually means a reissue
   * was started and abandoned.
   */
  draftInvoiceTotal: number
  creditNoteTotal: number
  unbilledTimeTotal: number
  unbilledMileageTotal: number
  unbilledOneOffTotal: number
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

  // Scoped to the client, not to invoices the OJ billing cron raised. This must
  // match getClientStatement or the drawer and the customer's PDF report a
  // different debt for the same client on the same day.
  //
  // Balance must not be derived from the visible invoice list; the drawer only
  // shows the latest 50 invoices, but the money total needs every unsettled row.
  const { data: unsettledInvoices, error: unsettledInvoicesError } = await supabase
    .from('invoices')
    .select('id, status, total_amount, paid_amount')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .not('status', 'in', '(paid,void,written_off)')

  if (unsettledInvoicesError) return { error: unsettledInvoicesError.message }

  // Fetch the most recent invoices for display only.
  const { data: displayInvoices, error: displayInvoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, reference, status, total_amount, paid_amount')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .order('invoice_date', { ascending: false })
    .limit(50)

  if (displayInvoicesError) return { error: displayInvoicesError.message }

  const outstandingOf = (inv: { total_amount?: unknown; paid_amount?: unknown }) =>
    Math.max(Number(inv.total_amount || 0) - Number(inv.paid_amount || 0), 0)

  // Unpaid invoice balance: sum of (total - paid) for invoices the client has
  // actually been sent. Drafts are excluded and reported on their own.
  const unpaidInvoiceBalance = roundMoney(
    (unsettledInvoices || [])
      .filter((inv) => !['paid', 'void', 'written_off', 'draft'].includes(inv.status))
      .reduce((acc, inv) => acc + outstandingOf(inv), 0)
  )

  const draftInvoiceTotal = roundMoney(
    (unsettledInvoices || [])
      .filter((inv) => inv.status === 'draft')
      .reduce((acc, inv) => acc + outstandingOf(inv), 0)
  )

  // Unbilled entries: use the rate snapshots stored at entry creation time
  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(
      'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot, amount_ex_vat_snapshot'
    )
    .eq('vendor_id', vendorId)
    .eq('status', 'unbilled')
    .eq('billable', true)

  if (entriesError) return { error: entriesError.message }

  // Fall back to the client's configured rates when an entry predates the
  // snapshot columns, matching what the billing engine will actually charge.
  // The engine tries snapshot, then the client's setting, then the default, so
  // omitting the middle candidate here valued the same work at the default rate
  // and overstated the balance for every client not on it.
  const { data: vendorSettings } = await supabase
    .from('oj_vendor_billing_settings')
    .select('vat_rate, hourly_rate_ex_vat, mileage_rate')
    .eq('vendor_id', vendorId)
    .maybeSingle()
  const defaultVatRate = typeof vendorSettings?.vat_rate === 'number' ? vendorSettings.vat_rate : 20

  let unbilledTimeTotal = 0
  let unbilledMileageTotal = 0
  let unbilledOneOffTotal = 0
  for (const entry of entries || []) {
    const vatRate = typeof entry.vat_rate_snapshot === 'number' ? entry.vat_rate_snapshot : defaultVatRate
    if (entry.entry_type === 'time') {
      const mins = Number(entry.duration_minutes_rounded || 0)
      const rate = resolveRate(
        entry.hourly_rate_ex_vat_snapshot,
        vendorSettings?.hourly_rate_ex_vat,
        DEFAULT_HOURLY_RATE_EX_VAT
      )
      unbilledTimeTotal = roundMoney(unbilledTimeTotal + moneyIncVat(roundMoney((mins / 60) * rate), vatRate))
    } else if (entry.entry_type === 'mileage') {
      // Mileage is a disbursement and is billed with no VAT, as in getEntryCharge.
      const miles = Number(entry.miles || 0)
      const mileageRate = resolveRate(
        entry.mileage_rate_snapshot,
        vendorSettings?.mileage_rate,
        DEFAULT_MILEAGE_RATE
      )
      unbilledMileageTotal = roundMoney(unbilledMileageTotal + roundMoney(miles * mileageRate))
    } else if (entry.entry_type === 'one_off') {
      const amount = roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
      unbilledOneOffTotal = roundMoney(unbilledOneOffTotal + moneyIncVat(amount, vatRate))
    }
  }

  // Unbilled recurring charge instances. Instances whose charge has since been
  // switched off are skipped: the billing run will never bill them, so counting
  // them here would overstate what the client owes.
  const { data: instances, error: instancesError } = await supabase
    .from('oj_recurring_charge_instances')
    .select('amount_ex_vat_snapshot, vat_rate_snapshot, recurring_charge:oj_vendor_recurring_charges(is_active)')
    .eq('vendor_id', vendorId)
    .eq('status', 'unbilled')

  if (instancesError) return { error: instancesError.message }

  const billableInstances = (instances || []).filter(
    (inst: any) => inst?.recurring_charge?.is_active !== false
  )

  const unbilledRecurringTotal = roundMoney(
    billableInstances.reduce((acc, inst) => {
      const exVat = roundMoney(Number(inst.amount_ex_vat_snapshot || 0))
      const vatRate = typeof inst.vat_rate_snapshot === 'number' ? inst.vat_rate_snapshot : defaultVatRate
      return acc + moneyIncVat(exVat, vatRate)
    }, 0)
  )

  const unbilledTotal = roundMoney(unbilledTimeTotal + unbilledMileageTotal + unbilledOneOffTotal + unbilledRecurringTotal)

  // Credit notes only reduce the balance of invoices that are still counted in
  // it. Scoping to the unsettled OJ invoice ids keeps three things out: notes
  // against invoices already settled (which have contributed nothing since the
  // filter above), notes against a draft (which no longer contributes either),
  // and notes against this vendor's non-OJ invoices, since invoice_vendors is
  // shared with the rest of the invoicing module.
  const unsettledInvoiceIds = (unsettledInvoices || [])
    .filter((inv) => inv.status !== 'draft')
    .map((inv) => String(inv.id))

  let creditNoteTotal = 0
  if (unsettledInvoiceIds.length > 0) {
    const { data: creditNotes, error: cnError } = await supabase
      .from('credit_notes')
      .select('amount_inc_vat, invoice_id')
      .eq('vendor_id', vendorId)
      .eq('status', 'issued')
      .in('invoice_id', unsettledInvoiceIds)

    if (cnError) {
      // Fails closed, matching getClientStatement. Continuing here showed a
      // balance as though no credit existed, so the drawer could overstate what
      // a client owed while looking perfectly healthy.
      console.error('[client-balance] credit_notes query failed:', cnError.message)
      return { error: 'Could not load credit notes, so the balance would be wrong. Please try again.' }
    } else {
      creditNoteTotal = roundMoney(
        (creditNotes || []).reduce((acc, cn) => acc + Number(cn.amount_inc_vat || 0), 0)
      )
    }
  }

  // A credit note can never take an invoice below zero, so clamp at zero rather
  // than letting an over-credit eat into other invoices' balances.
  const adjustedUnpaidInvoiceBalance = roundMoney(Math.max(unpaidInvoiceBalance - creditNoteTotal, 0))
  const totalOutstanding = roundMoney(adjustedUnpaidInvoiceBalance + unbilledTotal)

  const invoiceSummaries: ClientInvoiceSummary[] = (displayInvoices || []).map((inv) => ({
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
      unpaidInvoiceBalance: adjustedUnpaidInvoiceBalance,
      draftInvoiceTotal,
      creditNoteTotal,
      unbilledTimeTotal,
      unbilledMileageTotal,
      unbilledOneOffTotal,
      unbilledRecurringTotal,
      unbilledTotal,
      totalOutstanding,
      invoices: invoiceSummaries,
    },
  }
}
