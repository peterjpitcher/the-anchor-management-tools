import ReceiptsClient from './_components/ReceiptsClient'
import { getReceiptWorkspaceData, type ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptsNavItems } from './receiptsNavItems'

const STATUS_VALUES = new Set(['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'])
const DIRECTION_VALUES = new Set(['in', 'out'])
const SORT_COLUMNS = new Set(['transaction_date', 'details', 'amount_in', 'amount_out', 'amount_total'])
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function resolveMonthParam(value?: string) {
  if (value && MONTH_PATTERN.test(value)) {
    return value
  }

  const now = new Date()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}`
}

type ReceiptsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function ReceiptsPage({ searchParams }: ReceiptsPageProps) {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const resolvedParams = searchParams ? await searchParams : {}

  const rawStatus = typeof resolvedParams?.status === 'string' ? resolvedParams.status : undefined
  const status = rawStatus && STATUS_VALUES.has(rawStatus) ? rawStatus as ReceiptWorkspaceFilters['status'] : 'all'

  const rawDirection = typeof resolvedParams?.direction === 'string' ? resolvedParams.direction : undefined
  const direction = rawDirection && DIRECTION_VALUES.has(rawDirection) ? rawDirection as 'in' | 'out' : 'all'

  const outstandingParam = typeof resolvedParams?.outstanding === 'string' ? resolvedParams.outstanding : undefined
  const showOnlyOutstanding = outstandingParam === '0' ? false : true
  const needsVendorParam = typeof resolvedParams?.needsVendor === 'string' ? resolvedParams.needsVendor : undefined
  const needsExpenseParam = typeof resolvedParams?.needsExpense === 'string' ? resolvedParams.needsExpense : undefined
  const missingVendorOnly = needsVendorParam === '1'
  const missingExpenseOnly = needsExpenseParam === '1'
  const search = typeof resolvedParams?.search === 'string' ? resolvedParams.search : ''

  const rawSort = typeof resolvedParams?.sort === 'string' ? resolvedParams.sort : undefined
  const sortByFromQuery = rawSort && SORT_COLUMNS.has(rawSort) ? rawSort as ReceiptWorkspaceFilters['sortBy'] : undefined
  const rawSortDirection = typeof resolvedParams?.sortDirection === 'string' ? resolvedParams.sortDirection : undefined
  const sortDirectionFromQuery = rawSortDirection === 'asc' || rawSortDirection === 'desc' ? rawSortDirection : undefined

  const rawMonth = typeof resolvedParams?.month === 'string' ? resolvedParams.month : undefined

  let month: string | undefined
  if (rawMonth) {
    month = resolveMonthParam(rawMonth)
  } else if (!showOnlyOutstanding) {
    month = resolveMonthParam(undefined)
  }

  const defaultSortBy: ReceiptWorkspaceFilters['sortBy'] = !month ? 'amount_total' : 'transaction_date'
  const sortBy = sortByFromQuery ?? defaultSortBy
  const sortDirection = sortDirectionFromQuery ?? 'desc'

  const rawPage = typeof resolvedParams?.page === 'string' ? resolvedParams.page : undefined
  const page = rawPage ? parseInt(rawPage, 10) : 1

  let filters: ReceiptWorkspaceFilters = {
    status: status !== 'all' ? status : undefined,
    direction: direction !== 'all' ? direction : undefined,
    search: search ? search : undefined,
    showOnlyOutstanding,
    missingVendorOnly: missingVendorOnly ? true : undefined,
    missingExpenseOnly: missingExpenseOnly ? true : undefined,
    month,
    sortBy,
    sortDirection,
    page,
  }

  let data = await getReceiptWorkspaceData(filters)

  if (
    !rawMonth &&
    month &&
    data.transactions.length === 0 &&
    data.availableMonths.length > 0 &&
    !data.availableMonths.includes(month)
  ) {
    const fallbackMonth = data.availableMonths[0]
    filters = {
      ...filters,
      month: fallbackMonth,
    }
    data = await getReceiptWorkspaceData(filters)
  }

  const navItems = getReceiptsNavItems({
    view: 'workspace',
    missingVendorOnly,
    missingExpenseOnly,
  })

  return (
    <PageLayout
      title="Receipts"
      subtitle="Upload statements, tick off receipts, and download quarterly packs."
      navItems={navItems}
    >
      <ReceiptsClient
        initialData={data}
        initialFilters={{
          status,
          direction,
          search,
          showOnlyOutstanding,
          missingVendorOnly,
          missingExpenseOnly,
          month: filters.month ?? month,
          sortBy,
          sortDirection,
        }}
      />
    </PageLayout>
  )
}
