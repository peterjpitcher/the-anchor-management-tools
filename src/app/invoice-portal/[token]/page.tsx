import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyInvoiceToken } from '@/lib/invoices/invoice-token'
import { formatDateInLondon } from '@/lib/dateUtils'
import { InvoicePayClient } from './InvoicePayClient'
import { InvoicePayCaptureClient } from './InvoicePayCaptureClient'

// The page is public and its content changes with every payment, so it must
// never be cached or prerendered.
export const dynamic = 'force-dynamic'

// Deliberately generic. This URL reaches inboxes and link previewers, and the
// customer's name or what they owe is nobody else's business.
export const metadata = {
  title: 'Pay your invoice',
  robots: { index: false, follow: false },
}

function formatCurrency(amount: number): string {
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
    .select('id, invoice_number, status, total_amount, paid_amount, invoice_date, due_date, vendor:invoice_vendors(name)')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!invoice) notFound()

  const total = Number(invoice.total_amount || 0)
  const paid = Number(invoice.paid_amount || 0)
  const outstanding = Math.round((total - paid) * 100) / 100
  const settled = invoice.status === 'paid' || outstanding <= 0
  const withdrawn = invoice.status === 'void' || invoice.status === 'written_off'
  const notYetIssued = invoice.status === 'draft'
  const payable = !settled && !withdrawn && !notYetIssued

  const vendorName = (invoice as unknown as { vendor?: { name?: string | null } | null }).vendor?.name ?? null
  const paymentPending = query.payment_pending === '1'
  const paypalOrderId = typeof query.token === 'string' ? query.token : null

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-gray-500">The Anchor</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            Invoice {invoice.invoice_number}
          </h1>
          {vendorName && <p className="mt-1 text-sm text-gray-600">{vendorName}</p>}

          {/* The capture runs on return from PayPal, before anything below is
              read, so the amounts shown are the ones after payment. */}
          {payable && paymentPending && paypalOrderId && (
            <InvoicePayCaptureClient token={token} paypalOrderId={paypalOrderId} />
          )}

          <dl className="mt-6 space-y-3 border-t border-gray-100 pt-6 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-600">Invoice total</dt>
              <dd className="font-medium text-gray-900">{formatCurrency(total)}</dd>
            </div>
            {paid > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">Already paid</dt>
                <dd className="font-medium text-gray-900">{formatCurrency(paid)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-gray-100 pt-3">
              <dt className="font-medium text-gray-900">Outstanding</dt>
              <dd className="text-lg font-bold text-gray-900">
                {formatCurrency(Math.max(outstanding, 0))}
              </dd>
            </div>
            {payable && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">Due</dt>
                <dd className="text-gray-900">{formatDateInLondon(invoice.due_date, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6">
            {settled && (
              <p className="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
                This invoice is paid in full. Thank you.
              </p>
            )}
            {withdrawn && (
              <p className="rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700">
                This invoice has been cancelled, so there is nothing to pay. If you were
                expecting to pay something, please get in touch.
              </p>
            )}
            {notYetIssued && (
              <p className="rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700">
                This invoice has not been issued yet.
              </p>
            )}
            {payable && <InvoicePayClient token={token} amountDue={outstanding} />}
          </div>

          <p className="mt-6 border-t border-gray-100 pt-6 text-xs text-gray-500">
            Questions about this invoice? Email{' '}
            <a href="mailto:manager@the-anchor.pub" className="text-blue-700 underline">
              manager@the-anchor.pub
            </a>
            .
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          Orange Jelly Limited, trading as The Anchor
        </p>
      </div>
    </main>
  )
}
