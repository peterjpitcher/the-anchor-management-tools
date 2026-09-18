import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyInvoiceToken } from '@/lib/invoices/invoice-token'
import { invoiceBalanceDue, invoiceIssuedCreditTotal } from '@/lib/invoices/balance'
import { formatDateInLondon } from '@/lib/dateUtils'
import { Card } from '@/ds'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { invoiceReplyToAddress } from '@/lib/email/invoice-sender'
import { cn } from '@/lib/utils'
import { InvoicePayClient } from './InvoicePayClient'
import { InvoicePayCaptureClient } from './InvoicePayCaptureClient'
import { OrangeJellyShell } from './OrangeJellyShell'
import { StatusNote } from './StatusNote'

// Public, and its content changes with every payment, so it must never be
// cached or prerendered.
export const dynamic = 'force-dynamic'

// Deliberately generic. This URL reaches inboxes and link previewers, and who
// owes what is nobody else's business.
export const metadata = {
  title: 'Pay your invoice',
  robots: { index: false, follow: false },
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * Where invoice questions go: the Orange Jelly reply-to mailbox the invoice emails use, or the
 * company record when that is not configured. Never an invented address.
 */
function questionsEmail(): string {
  const configured = invoiceReplyToAddress()
  if (!configured) return GUEST_CONTACT.email
  return configured.match(/<([^<>]+)>/)?.[1]?.trim() ?? configured
}

function InvoiceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-text-muted">{label}</span>
      <span className={cn('text-right tabular-nums', emphasis ? 'font-semibold text-text-strong' : 'font-medium text-text')}>
        {value}
      </span>
    </div>
  )
}

export default async function InvoicePortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const query = await searchParams

  // The signed token IS the access control. There is no session here.
  const invoiceId = verifyInvoiceToken(token)
  if (!invoiceId) notFound()

  const admin = createAdminClient()
  const { data: invoice } = await admin
    .from('invoices')
    .select('id, invoice_number, status, total_amount, paid_amount, invoice_date, due_date, sent_at, vendor:invoice_vendors(name, contact_name, paypal_payments_enabled), credits:credit_notes(status, amount_inc_vat)')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!invoice) notFound()

  const total = Number(invoice.total_amount || 0)
  const paid = Number(invoice.paid_amount || 0)
  const creditTotal = invoiceIssuedCreditTotal(invoice)
  const outstanding = invoiceBalanceDue(invoice)

  const withdrawn = invoice.status === 'void' || invoice.status === 'written_off'
  const settled = !withdrawn && (invoice.status === 'paid' || outstanding <= 0)
  // A draft that has actually been emailed is payable: `sent_at` is the
  // authoritative delivery record, and the send's status flip can fail after
  // the email has already reached the customer.
  const notYetIssued = invoice.status === 'draft' && !invoice.sent_at

  const vendor = (invoice as unknown as {
    vendor?: {
      name?: string | null
      contact_name?: string | null
      paypal_payments_enabled?: boolean | null
    } | null
  }).vendor
  const invoiceCollectible = !settled && !withdrawn && !notYetIssued
  const paypalEnabled = vendor?.paypal_payments_enabled === true
  const payable = invoiceCollectible && paypalEnabled
  const paymentUnavailable = invoiceCollectible && !paypalEnabled
  const firstName = (vendor?.contact_name || vendor?.name || '').trim().split(' ')[0]
  // The heading and the headline figure must agree with the state. A cancelled
  // invoice showing "Pay your invoice" over "Amount due now GBP 975.60"
  // contradicts the notice sitting directly under it, and the big number is the
  // part people read first.
  const heading = settled
    ? creditTotal > 0 ? 'This invoice is settled' : 'This invoice is paid'
    : withdrawn
      ? 'This invoice has been cancelled'
      : notYetIssued
        ? 'This invoice is not ready yet'
        : paymentUnavailable
          ? 'Online payment is unavailable'
          : 'Pay your invoice'

  const lead = settled
    ? 'Thank you, there is nothing left to pay.'
    : withdrawn
      ? 'There is nothing to pay on this one.'
      : notYetIssued
        ? 'We have not issued this invoice yet.'
        : paymentUnavailable
          ? firstName
            ? `Hi ${firstName}, please use the payment details on the invoice or contact us if you need help.`
            : 'Please use the payment details on the invoice or contact us if you need help.'
        : firstName
          ? `Hi ${firstName}, here's what's outstanding on this invoice.`
          : `Here's what's outstanding on this invoice.`

  // Only shown where a figure genuinely means something: what is owed, or what
  // was paid. A withdrawn or unissued invoice has no headline amount.
  const showAmount = invoiceCollectible || settled

  const paymentPending = query.payment_pending === '1'
  // PayPal appends its order id as `token`, which collides confusingly with the
  // portal token in the path. The one in the query string is always PayPal's.
  const paypalOrderId = typeof query.token === 'string' ? query.token : null

  const contactEmail = questionsEmail()

  return (
    <OrangeJellyShell>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Invoice {invoice.invoice_number}</p>
        <h1 className="text-2xl font-bold tracking-tight text-text-strong">{heading}</h1>
        <p className="text-sm text-text-muted">{lead}</p>
      </div>

      <Card padding="lg">
        {/* Runs before the figures below are read, so what is shown is the
            state after payment. */}
        {invoiceCollectible && paymentPending && paypalOrderId && (
          <InvoicePayCaptureClient token={token} paypalOrderId={paypalOrderId} />
        )}

        {showAmount && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
              {settled ? creditTotal > 0 ? 'Payments received' : 'Paid in full' : 'Amount due now'}
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-text-strong">
              {formatMoney(settled ? paid : Math.max(outstanding, 0))}
            </p>
          </div>
        )}

        <div className={showAmount ? 'mt-4' : ''}>
          <InvoiceRow label="Invoice" value={invoice.invoice_number} />
          <InvoiceRow label="Invoice total" value={formatMoney(total)} />
          {creditTotal > 0 && <InvoiceRow label="Credits applied" value={formatMoney(creditTotal)} />}
          {paid > 0 && <InvoiceRow label="Already paid" value={formatMoney(paid)} />}
          {invoiceCollectible && (
            <InvoiceRow
              label="Due"
              value={formatDateInLondon(invoice.due_date, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              emphasis
            />
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {settled && (
            <StatusNote tone="success">
              {creditTotal > 0 ? 'This invoice is settled, including the credits shown above. Thank you.' : 'This invoice is paid in full. Thank you.'}
            </StatusNote>
          )}
          {withdrawn && (
            <StatusNote tone="notice">
              This invoice has been cancelled, so there is nothing to pay. If you
              were expecting to pay something, please get in touch.
            </StatusNote>
          )}
          {notYetIssued && (
            <StatusNote tone="notice">
              This invoice has not been issued yet.
            </StatusNote>
          )}
          {paymentUnavailable && (
            <StatusNote tone="notice">
              Online payment is not available for this invoice.
            </StatusNote>
          )}
          {payable && <InvoicePayClient token={token} amountDue={outstanding} />}
        </div>

        {payable && (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-text-muted">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
            Secure payment via PayPal
          </p>
        )}
      </Card>

      <p className="text-center text-ui leading-relaxed text-text-muted">
        Questions about this invoice? Email{' '}
        <a href={`mailto:${contactEmail}`} className="text-primary underline underline-offset-2">
          {contactEmail}
        </a>{' '}
        or call {GUEST_CONTACT.phoneDisplay}.
      </p>
    </OrangeJellyShell>
  )
}
