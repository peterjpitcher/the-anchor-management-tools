import { z } from 'zod'
import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'

function hasPrecision(value: number, places: number): boolean {
  return Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 0.000001
}

export const extraChargeLineSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  quantity: z.number().finite().positive().max(100000).refine(value => hasPrecision(value, 3), 'Quantity allows at most three decimal places.'),
  unit_price: z.number().finite().nonnegative().max(1000000).refine(value => hasPrecision(value, 2), 'Price must be in whole pennies.'),
  discount_percentage: z.number().finite().min(0).max(100).refine(value => hasPrecision(value, 2), 'Discount allows at most two decimal places.'),
  vat_rate: z.number().finite().min(0).max(100).refine(value => hasPrecision(value, 2), 'VAT allows at most two decimal places.'),
  catalog_item_id: z.string().uuid().nullable().optional(),
  display_order: z.number().int().nonnegative().optional(),
})
export type ExtraChargeLine = z.infer<typeof extraChargeLineSchema>
export const billingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, 'Enter a valid date.')
export const extraChargeDraftSchema = z.object({
  bookingId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  dueDate: billingDateSchema,
  reference: z.string().trim().max(500).optional(),
  lines: z.array(extraChargeLineSchema).min(1).max(100),
})
export type SaveExtraChargeInput = z.infer<typeof extraChargeDraftSchema>
export interface ExtraChargeBatch {
  id: string
  booking_id: string
  status: 'draft' | 'issued' | 'void'
  delivery_state?: 'not_sent' | 'sending' | 'sent' | 'failed'
  delivery_error?: string | null
  invoice_id: string | null
  lines: ExtraChargeLine[]
  due_date: string
  reference: string | null
  revision: number
  created_at: string
  updated_at: string
}
export interface BookingBillingInvoice {
  id: string
  invoice_number: string
  kind: 'original' | 'supplementary'
  status: string
  invoice_date: string
  due_date: string
  total_amount: number
  paid_amount: number
  credit_amount: number
  balance: number
  sent_at: string | null
  paypalEnabled: boolean
  paymentUrl: string | null
  deliveryState: 'sent' | 'failed' | 'not_sent' | 'sending'
}
export interface PrivateBookingBilling {
  batches: ExtraChargeBatch[]
  invoices: BookingBillingInvoice[]
  supplementaryTotal: number
  collectibleBalance: number
  creditsTotal: number
}
export interface ExtraChargePreview {
  batch: ExtraChargeBatch
  totals: InvoiceTotalsResult
  recipientEmail: string
  paypalEnabled: boolean
  sourceHash: string
}
export interface IssueExtraChargeInput {
  bookingId: string
  batchId: string
  expectedRevision: number
  sourceHash: string
  allowWithoutOnlinePayment: boolean
}
export const allocatedPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  receiptId: z.string().uuid(),
  amount: z.number().finite().positive().max(100000000),
  paymentDate: billingDateSchema,
  method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'other']),
  reference: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number().finite().positive() })).min(1).max(100),
}).superRefine((value, ctx) => {
  const sum = value.allocations.reduce((total, row) => total + Math.round(row.amount * 100), 0)
  if (sum !== Math.round(value.amount * 100)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Allocations must equal the payment received.' })
  if (new Set(value.allocations.map(row => row.invoiceId)).size !== value.allocations.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select each invoice only once.' })
  if ([value.amount, ...value.allocations.map(row => row.amount)].some(amount => Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Payment amounts must be in whole pennies.' })
})
export type AllocatedBookingPaymentInput = z.infer<typeof allocatedPaymentSchema>
export type BillingActionResult<T> = { error?: string } & Partial<T>

/** Extras intentionally receive no inherited booking-wide discount. */
export function calculateExtraChargeTotals(lines: ExtraChargeLine[]): InvoiceTotalsResult {
  return calculateInvoiceTotals(lines, 0)
}
