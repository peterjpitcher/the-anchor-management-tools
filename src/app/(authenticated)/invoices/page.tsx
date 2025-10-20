import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getInvoices, getInvoiceSummary } from '@/app/actions/invoices'
import InvoicesClient from './InvoicesClient'

const EMPTY_SUMMARY = {
  total_outstanding: 0,
  total_overdue: 0,
  total_this_month: 0,
  count_draft: 0,
}

export default async function InvoicesPage() {
  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [
    invoicesResult,
    summaryResult,
    canCreate,
    canEdit,
    canDelete,
    canExport,
    canManageCatalog,
  ] = await Promise.all([
    getInvoices('unpaid'),
    getInvoiceSummary(),
    checkUserPermission('invoices', 'create'),
    checkUserPermission('invoices', 'edit'),
    checkUserPermission('invoices', 'delete'),
    checkUserPermission('invoices', 'export'),
    checkUserPermission('invoices', 'manage'),
  ])

  const errorMessages: string[] = []

  if (invoicesResult.error) {
    errorMessages.push('We were unable to load the latest invoices. Data shown below may be out of date.')
  }

  if (summaryResult.error) {
    errorMessages.push('Invoice summary totals could not be refreshed.')
  }

  const initialInvoices = invoicesResult.invoices ?? []
  const initialSummary = summaryResult.summary ?? EMPTY_SUMMARY
  const initialError = errorMessages.length > 0 ? errorMessages.join(' ') : null

  return (
    <InvoicesClient
      initialInvoices={initialInvoices}
      initialSummary={initialSummary}
      initialStatus="unpaid"
      initialError={initialError}
      permissions={{
        canCreate,
        canEdit,
        canDelete,
        canExport,
        canManageCatalog,
      }}
    />
  )
}
