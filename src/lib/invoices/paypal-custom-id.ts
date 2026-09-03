/**
 * The `custom_id` PayPal carries on an invoice payment order.
 *
 * This prefix is the only thing the webhook routes on, so it has to be
 * identical on the order it creates and the event it receives. It lives here
 * rather than in the server action because a `'use server'` module may only
 * export async functions, and the webhook needs the plain value.
 */
export const INVOICE_PAYMENT_CUSTOM_ID_PREFIX = 'inv-pay-'

export function invoicePaymentCustomId(invoiceId: string): string {
  return `${INVOICE_PAYMENT_CUSTOM_ID_PREFIX}${invoiceId}`
}
