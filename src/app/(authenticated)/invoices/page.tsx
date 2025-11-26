import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getInvoices, getInvoiceSummary } from '@/app/actions/invoices'
import InvoicesClient from './InvoicesClient'
import type { InvoiceStatus } from '@/types/invoices'

const EMPTY_SUMMARY = {
  total_outstanding: 0,
  total_overdue: 0,
  total_this_month: 0,
  count_draft: 0,
}

interface Props {
  searchParams: Promise<{
    page?: string
    search?: string
    status?: string
  }>
}

export default async function InvoicesPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams
  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const page = Number(resolvedSearchParams.page) || 1
  const search = resolvedSearchParams.search || ''
  const rawStatus = resolvedSearchParams.status
  const clientStatus = (rawStatus || 'unpaid') as InvoiceStatus | 'all' | 'unpaid'
  const serviceStatus = clientStatus === 'all' ? undefined : clientStatus

  const limit = 20

  const [
    invoicesResult,
    summaryResult,
    canCreate,
    canEdit,
    canDelete,
    canExport,
    canManageCatalog,
  ] = await Promise.all([
    getInvoices(serviceStatus, page, limit, search),
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
  const totalInvoices = invoicesResult.total ?? 0
  const initialSummary = summaryResult.summary ?? EMPTY_SUMMARY
  const initialError = errorMessages.length > 0 ? errorMessages.join(' ') : null

  return (
    <InvoicesClient
      initialInvoices={initialInvoices}
      initialTotal={totalInvoices}
      initialSummary={initialSummary}
      initialStatus={clientStatus}
      initialPage={page}
      initialSearch={search}
      initialLimit={limit}
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