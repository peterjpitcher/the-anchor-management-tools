/**
 * What a logged entry or a recurring charge is worth.
 *
 * These lived inside the 3,800-line billing cron route. They are the rules that
 * decide what a client is actually charged, and the Work Record has to state the
 * same numbers the invoice did. A second copy of this arithmetic would guarantee
 * a customer-facing document that contradicts its own invoice, so there is one
 * copy and the cron imports it back.
 *
 * Moved verbatim. No behaviour change.
 */

import {
  DEFAULT_HOURLY_RATE_EX_VAT,
  DEFAULT_MILEAGE_RATE,
  resolveRate,
} from '@/lib/oj-projects/rates'
import { roundMoney } from '@/lib/oj-projects/utils'

export interface Charge {
  exVat: number
  vatRate: number
  incVat: number
}

export function moneyIncVat(exVat: number, vatRate: number): number {
  return roundMoney(exVat + roundMoney(exVat * (vatRate / 100)))
}

export function getEntryCharge(entry: any, settings: any): Charge {
  const entryType = String(entry?.entry_type || '')

  if (entryType === 'mileage') {
    // Mileage is a disbursement and is billed zero-rated.
    const miles = Number(entry.miles || 0)
    const rate = resolveRate(entry.mileage_rate_snapshot, settings?.mileage_rate, DEFAULT_MILEAGE_RATE)
    const exVat = roundMoney(miles * rate)
    return { exVat, vatRate: 0, incVat: roundMoney(exVat) }
  }

  if (entryType === 'one_off') {
    const exVat = roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
    const vatRate = Number(entry.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
    return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
  }

  const minutes = Number(entry.duration_minutes_rounded || 0)
  const rate = resolveRate(entry.hourly_rate_ex_vat_snapshot, settings?.hourly_rate_ex_vat, DEFAULT_HOURLY_RATE_EX_VAT)
  const vatRate = Number(entry.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
  const exVat = roundMoney((minutes / 60) * rate)
  return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
}

export function getRecurringCharge(instance: any): Charge {
  const exVat = roundMoney(Number(instance.amount_ex_vat_snapshot || 0))
  const vatRate = Number(instance.vat_rate_snapshot || 0)
  return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
}
