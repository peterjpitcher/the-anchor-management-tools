import { redirect } from 'next/navigation'
import { checkUserPermission, getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getInvoiceListPage, getInvoiceSummary } from '@/app/actions/invoices'
import InvoicesClient from './_components/InvoicesClient'
import type { InvoiceStatus } from '@/types/invoices'
import type { ActionType } from '@/types/rbac'

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

const PAGE_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'manage'] as const
type PageAction = (typeof PAGE_ACTIONS)[number] & ActionType

/**
 * Answers the six invoice permissions this page needs, exactly as six checkUserPermission calls
 * would, in one permissions read for nearly every user.
 *
 * getCurrentUserModuleActions lists only the permission rows a user's roles hold, while
 * checkUserPermission also allows a super admin everything and answers no when the lookup
 * fails. So an action missing from the list is not yet a no: one checkUserPermission call on
 * the first missing action settles it. If that says no, the user is not a super admin and every
 * other missing action is a no as well (both read the same cached permission list). If it says
 * yes, the remaining missing actions are checked one by one, as before.
 */
async function resolveInvoicePagePermissions(): Promise<Record<PageAction, boolean>> {
  const moduleActions = await getCurrentUserModuleActions('invoices')
  const held = new Set<string>('actions' in moduleActions ? moduleActions.actions : [])

  const result = Object.fromEntries(
    PAGE_ACTIONS.map((action) => [action, held.has(action)])
  ) as Record<PageAction, boolean>

  const missing = PAGE_ACTIONS.filter((action) => !result[action])
  if (missing.length === 0) return result

  const [probe, ...rest] = missing
  result[probe] = await checkUserPermission('invoices', probe)
  if (result[probe] && rest.length > 0) {
    const answers = await Promise.all(rest.map((action) => checkUserPermission('invoices', action)))
    rest.forEach((action, index) => {
      result[action] = answers[index]
    })
  }
  return result
}

export default async function InvoicesPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams
  const permissions = await resolveInvoicePagePermissions()
  if (!permissions.view) {
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

  const [invoicesResult, summaryResult] = await Promise.all([
    getInvoiceListPage(serviceStatus, page, limit, search, vendorSearch, startDate, endDate),
    getInvoiceSummary(),
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
      initialListFailed={Boolean(invoicesResult.error)}
      permissions={{
        canCreate: permissions.create,
        canEdit: permissions.edit,
        canDelete: permissions.delete,
        canExport: permissions.export,
        canManageCatalog: permissions.manage,
      }}
    />
  )
}
