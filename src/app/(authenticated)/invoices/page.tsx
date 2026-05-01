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
    vendor?: string
    status?: string
    start_date?: string
    end_date?: string
  }>
}

type InvoiceListStatus = InvoiceStatus | 'all' | 'unpaid'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const VALID_STATUS_FILTERS = new Set<string>([
  'all',
  'unpaid',
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
  'written_off',
])

function resolvePage(rawPage: string | undefined) {
  const page = Number.parseInt(rawPage || '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function resolveStatus(rawStatus: string | undefined): InvoiceListStatus {
  return VALID_STATUS_FILTERS.has(rawStatus || '')
    ? rawStatus as InvoiceListStatus
    : 'unpaid'
}

function resolveIsoDate(rawDate: string | undefined) {
  return rawDate && ISO_DATE_RE.test(rawDate) ? rawDate : ''
}

export default async function InvoicesPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams
  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const page = resolvePage(resolvedSearchParams.page)
  const search = resolvedSearchParams.search || ''
  const vendorSearch = resolvedSearchParams.vendor || ''
  const startDate = resolveIsoDate(resolvedSearchParams.start_date)
  const endDate = resolveIsoDate(resolvedSearchParams.end_date)
  const clientStatus = resolveStatus(resolvedSearchParams.status)
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
    getInvoices(serviceStatus, page, limit, search, vendorSearch, startDate, endDate),
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
      initialVendorSearch={vendorSearch}
      initialStartDate={startDate}
      initialEndDate={endDate}
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
