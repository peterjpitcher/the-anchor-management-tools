/**
 * Loads the rows behind `buildAccountPosition` for one client.
 *
 * One loader, so the statement, the Work Record and the client drawer cannot
 * each read a slightly different set of rows and then disagree about what the
 * client owes. Takes whichever Supabase client the caller already holds, so it
 * runs under that caller's permissions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { moneyIncVat } from '@/lib/oj-projects/charges'
import { formatRecurringPeriodLabel } from '@/lib/oj-projects/recurring-periods'
import {
  buildAccountPosition,
  type AccountPosition,
  type PositionEntry,
  type PositionInvoice,
  type PositionRecurring,
} from '@/lib/oj-projects/account-position'

export interface NotYetInvoicedCharge {
  description: string
  /** For example "Jun 2026" or "2026-06", as the invoice would label it. */
  period: string
  exVat: number
  vatRate: number
}

export interface LoadedAccountPosition {
  position: AccountPosition
  /** Regular charges with a month already gone and not yet on an invoice. */
  notYetInvoicedCharges: NotYetInvoicedCharge[]
  /** Flat monthly amount inc VAT, or null when the client is invoiced in full. */
  monthlyCapIncVat: number | null
  /** What the client's active monthly charges add to each future invoice, inc VAT. */
  monthlyChargesIncVat: number
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function loadAccountPosition(
  // The generated Database type does not help here and the callers hold
  // differently typed clients (cookie session and service role).
  supabase: SupabaseClient<any, any, any>,
  vendorId: string
): Promise<{ data?: LoadedAccountPosition; error?: string }> {
  try {
    const [settingsResult, chargesResult] = await Promise.all([
      supabase
        .from('oj_vendor_billing_settings')
        .select('hourly_rate_ex_vat, mileage_rate, vat_rate, billing_mode, monthly_cap_inc_vat')
        .eq('vendor_id', vendorId)
        .maybeSingle(),
      supabase
        .from('oj_vendor_recurring_charges')
        .select('amount_ex_vat, vat_rate, frequency, is_active, end_date')
        .eq('vendor_id', vendorId)
        .eq('is_active', true)
        .limit(1000),
    ])

    if (settingsResult.error) return { error: settingsResult.error.message }
    if (chargesResult.error) return { error: chargesResult.error.message }

    // Paged, like the entries below. A long-standing client can pass 1,000
    // rows, and a silently short read here understates what they owe.
    const invoices = await fetchAllRows<PositionInvoice>(
      (from, to) =>
        supabase
          .from('invoices')
          .select('id, status, total_amount, paid_amount, reference, is_fixed_price')
          .eq('vendor_id', vendorId)
          .is('deleted_at', null)
          .not('status', 'in', '("void","written_off","draft")')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'account position invoices' }
    )

    const entries = await fetchAllRows<PositionEntry>(
      (from, to) =>
        supabase
          .from('oj_entries')
          .select(
            'entry_type, duration_minutes_rounded, miles, amount_ex_vat_snapshot, hourly_rate_ex_vat_snapshot, mileage_rate_snapshot, vat_rate_snapshot, billable, status, invoice_id'
          )
          .eq('vendor_id', vendorId)
          .eq('billable', true)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'account position entries' }
    )

    const instances = await fetchAllRows<any>(
      (from, to) =>
        supabase
          .from('oj_recurring_charge_instances')
          .select(
            'status, invoice_id, amount_ex_vat_snapshot, vat_rate_snapshot, description_snapshot, period_yyyymm, period_start, recurring_charge:oj_vendor_recurring_charges(is_active)'
          )
          .eq('vendor_id', vendorId)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'account position recurring charges' }
    )

    const settings = settingsResult.data
    const recurring: PositionRecurring[] = instances.map((inst) => {
      const charge = Array.isArray(inst.recurring_charge) ? inst.recurring_charge[0] : inst.recurring_charge
      return {
        status: inst.status,
        invoice_id: inst.invoice_id,
        amount_ex_vat_snapshot: inst.amount_ex_vat_snapshot,
        vat_rate_snapshot: inst.vat_rate_snapshot,
        charge_active: charge?.is_active ?? null,
      }
    })

    const position = buildAccountPosition({
      entries,
      recurring,
      invoices,
      settings,
    })

    const defaultVatRate = Number(settings?.vat_rate ?? 20)
    const notYetInvoicedCharges: NotYetInvoicedCharge[] = instances
      .filter((inst) => {
        const charge = Array.isArray(inst.recurring_charge) ? inst.recurring_charge[0] : inst.recurring_charge
        return inst.status === 'unbilled' && charge?.is_active !== false
      })
      .sort((a, b) => String(a.period_start || '').localeCompare(String(b.period_start || '')))
      .map((inst) => ({
        description: String(inst.description_snapshot || 'Monthly charge'),
        period: formatRecurringPeriodLabel(inst.period_yyyymm),
        exVat: roundMoney(Number(inst.amount_ex_vat_snapshot || 0)),
        vatRate: typeof inst.vat_rate_snapshot === 'number' ? inst.vat_rate_snapshot : defaultVatRate,
      }))

    // Only monthly charges are certain to recur on every future invoice. A
    // quarterly or annual one lands in some months and not others, so it is
    // left out rather than smeared across the forecast.
    const monthlyChargesIncVat = roundMoney(
      (chargesResult.data || [])
        .filter((c: any) => String(c.frequency || 'monthly') === 'monthly' && !c.end_date)
        .reduce(
          (acc: number, c: any) =>
            acc + moneyIncVat(roundMoney(Number(c.amount_ex_vat || 0)), Number(c.vat_rate ?? defaultVatRate)),
          0
        )
    )

    return {
      data: {
        position,
        notYetInvoicedCharges,
        monthlyCapIncVat:
          settings?.billing_mode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number'
            ? settings.monthly_cap_inc_vat
            : null,
        monthlyChargesIncVat,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not load the account position' }
  }
}
