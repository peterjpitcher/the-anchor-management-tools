/**
 * House payment terms: seven days unless a customer has been given longer.
 *
 * Owner rule, 2026-08-31. The default was 30 in six places (the vendor schema,
 * two vendor forms, the new-invoice form, the OJ clients form and the billing
 * cron) plus the `invoice_vendors` column default, so a new customer silently
 * got four times the intended credit. Import this rather than writing a number.
 *
 * The `vendors` table is NOT covered: those are private-booking suppliers whose
 * terms govern when we pay them, and its default stays at 30.
 */
export const DEFAULT_PAYMENT_TERMS_DAYS = 7

export function parsePaymentTermsValue(value: FormDataEntryValue | null): number | undefined {
  if (value == null) return undefined
  const stringValue = String(value).trim()
  if (!stringValue) return undefined

  const parsed = Number.parseInt(stringValue, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return undefined
  }

  return parsed
}
