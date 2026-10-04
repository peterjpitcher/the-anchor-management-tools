/**
 * The three switches that keep new invoice email behaviour off until the owner turns it on.
 *
 * Each one FAILS CLOSED: unset, empty or mistyped means off. Deploying this code therefore
 * starts no new customer email. They are read when an email is about to be sent, never cached.
 * On Vercel a changed environment variable only reaches a NEW deployment, so setting one means
 * redeploying before it takes effect.
 *
 * See tasks/spec-2026-10-04-invoice-issuing-and-chasing.md, "Release switches".
 */

function readTrimmed(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function readIsoDate(name: string): string | null {
  const value = readTrimmed(name)
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  // Rejects dates that parse but do not exist, such as 2026-02-31.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null
  return value
}

/**
 * `INVOICE_EMAIL_PROVIDER=graph`: invoice emails leave from the Orange Jelly mailbox through
 * Microsoft Graph, so they sit in its Sent Items and replies come straight back.
 *
 * Returns undefined when off, which leaves `sendEmail` choosing the provider as it does today.
 * Only `graph` is accepted: there is no reason to pin invoices to anything else.
 */
export function invoiceEmailProvider(): 'graph' | undefined {
  return readTrimmed('INVOICE_EMAIL_PROVIDER')?.toLowerCase() === 'graph' ? 'graph' : undefined
}

/**
 * `INVOICE_REMINDERS_GO_LIVE_DATE=YYYY-MM-DD`: automatic reminders are sent for invoices that
 * fall due on or after this date. Null means the reminder job emails no customer at all.
 */
export function invoiceRemindersGoLiveDate(): string | null {
  return readIsoDate('INVOICE_REMINDERS_GO_LIVE_DATE')
}

/**
 * `INVOICE_PAYPAL_RECEIPTS_FROM=YYYY-MM-DD`: a PayPal payment recorded on or after this date
 * sends the customer a receipt. Null means PayPal payments send no receipt, as before. The
 * date is what stops a payment recorded before the switch getting a late, surprising receipt.
 */
export function invoicePayPalReceiptsFrom(): string | null {
  return readIsoDate('INVOICE_PAYPAL_RECEIPTS_FROM')
}
