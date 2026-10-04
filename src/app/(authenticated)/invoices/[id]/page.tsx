import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getInvoice } from '@/app/actions/invoices'
import { getEmailConfigStatus, getInvoiceEmailDraftContext } from '@/app/actions/email'
import InvoiceDetailClient from './InvoiceDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvoicePage({ params }: Props) {
  const { id } = await params

  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  // The email dialogs draft in the browser, but who to greet comes from contact and guest
  // records most staff cannot read there, so it is resolved here (on the admin client,
  // behind the invoice view permission) and handed down.
  const [invoiceResult, emailConfigResult, emailDraftContext] = await Promise.all([
    getInvoice(id),
    getEmailConfigStatus(),
    getInvoiceEmailDraftContext(id)
  ])

  if (invoiceResult.error || !invoiceResult.invoice) {
    notFound()
  }

  return (
    <InvoiceDetailClient 
      initialInvoice={invoiceResult.invoice}
      emailConfigured={!emailConfigResult.error && !!emailConfigResult.configured}
      emailGreetingName={emailDraftContext.greetingName}
      emailBookingEventDate={emailDraftContext.bookingEventDate}
    />
  )
}