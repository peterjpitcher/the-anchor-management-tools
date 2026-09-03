import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyInvoiceToken } from '@/lib/invoices/invoice-token'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  GuestShell,
  GuestCard,
  GuestAmount,
  GuestAlert,
  DetailRow,
  TrustLine,
} from '@/components/features/guest'
import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { InvoicePayClient } from './InvoicePayClient'
import { InvoicePayCaptureClient } from './InvoicePayCaptureClient'

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
    .select('id, invoice_number, status, total_amount, paid_amount, invoice_date, due_date, sent_at, vendor:invoice_vendors(name, contact_name)')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!invoice) notFound()

  const total = Number(invoice.total_amount || 0)
  const paid = Number(invoice.paid_amount || 0)
  const outstanding = Math.round((total - paid) * 100) / 100

  const settled = invoice.status === 'paid' || outstanding <= 0
  const withdrawn = invoice.status === 'void' || invoice.status === 'written_off'
  // A draft that has actually been emailed is payable: `sent_at` is the
  // authoritative delivery record, and the send's status flip can fail after
  // the email has already reached the customer.
  const notYetIssued = invoice.status === 'draft' && !invoice.sent_at
  const payable = !settled && !withdrawn && !notYetIssued

  const vendor = (invoice as unknown as {
    vendor?: { name?: string | null; contact_name?: string | null } | null
  }).vendor
  const firstName = (vendor?.contact_name || vendor?.name || '').trim().split(' ')[0]
  const greeting = firstName
    ? `Hi ${firstName}, here's what's outstanding on this invoice.`
    : `Here's what's outstanding on this invoice.`

  const paymentPending = query.payment_pending === '1'
  // PayPal appends its order id as `token`, which collides confusingly with the
  // portal token in the path. The one in the query string is always PayPal's.
  const paypalOrderId = typeof query.token === 'string' ? query.token : null

  return (
    <GuestShell>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Invoice {invoice.invoice_number}</p>
        <h1 className={GUEST_H1_CLASS}>
          {settled ? 'This invoice is paid' : 'Pay your invoice'}
        </h1>
        <p className={GUEST_LEAD_CLASS}>{greeting}</p>
      </div>

      <GuestCard variant="accent">
        {/* Runs before the figures below are read, so what is shown is the
            state after payment. */}
        {payable && paymentPending && paypalOrderId && (
          <InvoicePayCaptureClient token={token} paypalOrderId={paypalOrderId} />
        )}

        <GuestAmount
          label={settled ? 'Paid in full' : 'Amount due now'}
          value={formatMoney(Math.max(outstanding, 0))}
        />

        <div className="mt-[18px]">
          <DetailRow label="Invoice" value={invoice.invoice_number} />
          <DetailRow label="Invoice total" value={formatMoney(total)} />
          {paid > 0 && <DetailRow label="Already paid" value={formatMoney(paid)} />}
          {payable && (
            <DetailRow
              label="Due"
              value={formatDateInLondon(invoice.due_date, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              emphasis="deadline"
            />
          )}
        </div>

        <div className="mt-[18px]">
          {settled && (
            <GuestAlert tone="success" role="status">
              This invoice is paid in full. Thank you.
            </GuestAlert>
          )}
          {withdrawn && (
            <GuestAlert tone="notice" role="status">
              This invoice has been cancelled, so there is nothing to pay. If you
              were expecting to pay something, please get in touch.
            </GuestAlert>
          )}
          {notYetIssued && (
            <GuestAlert tone="notice" role="status">
              This invoice has not been issued yet.
            </GuestAlert>
          )}
          {payable && <InvoicePayClient token={token} amountDue={outstanding} />}
        </div>

        {payable && (
          <div className="mt-[18px]">
            <TrustLine />
          </div>
        )}
      </GuestCard>

      <p className="mt-6 text-center font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
        Questions about this invoice? Email{' '}
        <a href={GUEST_CONTACT.emailHref} className="underline underline-offset-2">
          {GUEST_CONTACT.email}
        </a>{' '}
        or call {GUEST_CONTACT.phoneDisplay}.
      </p>
    </GuestShell>
  )
}
