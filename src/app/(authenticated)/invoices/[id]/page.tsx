import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getInvoice } from '@/app/actions/invoices'
import { getEmailConfigStatus } from '@/app/actions/email'
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

  const [invoiceResult, emailConfigResult] = await Promise.all([
    getInvoice(id),
    getEmailConfigStatus()
  ])

  if (invoiceResult.error || !invoiceResult.invoice) {
    notFound()
  }

  return (
    <InvoiceDetailClient 
      initialInvoice={invoiceResult.invoice}
      emailConfigured={!emailConfigResult.error && !!emailConfigResult.configured}
    />
  )
}