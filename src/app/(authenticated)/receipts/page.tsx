import ReceiptsClient from './_components/ReceiptsClient'
import { getReceiptWorkspaceData, type ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

const STATUS_VALUES = new Set(['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'])
const DIRECTION_VALUES = new Set(['in', 'out'])
const SORT_COLUMNS = new Set(['transaction_date', 'details', 'amount_in', 'amount_out'])
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
  const sortBy = rawSort && SORT_COLUMNS.has(rawSort) ? rawSort as ReceiptWorkspaceFilters['sortBy'] : 'transaction_date'
  const rawSortDirection = typeof resolvedParams?.sortDirection === 'string' ? resolvedParams.sortDirection : undefined
  const sortDirection = rawSortDirection === 'asc' ? 'asc' : 'desc'

  const rawMonth = typeof resolvedParams?.month === 'string' ? resolvedParams.month : undefined
  const month = resolveMonthParam(rawMonth)

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
  }

  let data = await getReceiptWorkspaceData(filters)

  if (
    !rawMonth &&
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

  return (
    <PageLayout
      title="Receipts"
      subtitle="Upload statements, tick off receipts, and download quarterly packs."
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
