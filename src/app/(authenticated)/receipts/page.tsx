import ReceiptsClient from './_components/ReceiptsClient'
import { getReceiptWorkspaceData, type ReceiptWorkspaceFilters } from '@/app/actions/receipts'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'

const STATUS_VALUES = new Set(['pending', 'completed', 'auto_completed', 'no_receipt_required'])
const DIRECTION_VALUES = new Set(['in', 'out'])
const SORT_COLUMNS = new Set(['transaction_date', 'details', 'amount_in', 'amount_out'])

type ReceiptsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function ReceiptsPage({ searchParams }: ReceiptsPageProps) {
  const resolvedParams = searchParams ? await searchParams : {}

  const rawStatus = typeof resolvedParams?.status === 'string' ? resolvedParams.status : undefined
  const status = rawStatus && STATUS_VALUES.has(rawStatus) ? rawStatus as ReceiptWorkspaceFilters['status'] : 'all'

  const rawDirection = typeof resolvedParams?.direction === 'string' ? resolvedParams.direction : undefined
  const direction = rawDirection && DIRECTION_VALUES.has(rawDirection) ? rawDirection as 'in' | 'out' : 'all'

  const outstandingParam = typeof resolvedParams?.outstanding === 'string' ? resolvedParams.outstanding : undefined
  const showOnlyOutstanding = outstandingParam === '0' ? false : true
  const search = typeof resolvedParams?.search === 'string' ? resolvedParams.search : ''

  const rawSort = typeof resolvedParams?.sort === 'string' ? resolvedParams.sort : undefined
  const sortBy = rawSort && SORT_COLUMNS.has(rawSort) ? rawSort as ReceiptWorkspaceFilters['sortBy'] : 'transaction_date'
  const rawSortDirection = typeof resolvedParams?.sortDirection === 'string' ? resolvedParams.sortDirection : undefined
  const sortDirection = rawSortDirection === 'asc' ? 'asc' : 'desc'

  const pageParam = typeof resolvedParams?.page === 'string' ? Number.parseInt(resolvedParams.page, 10) : 1
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filters: ReceiptWorkspaceFilters = {
    status: status !== 'all' ? status : undefined,
    direction: direction !== 'all' ? direction : undefined,
    search: search ? search : undefined,
    showOnlyOutstanding,
    page,
    sortBy,
    sortDirection,
  }

  const data = await getReceiptWorkspaceData(filters)

  return (
    <PageWrapper>
      <PageHeader
        title="Receipts"
        subtitle="Upload statements, tick off receipts, and download quarterly packs."
      />
      <PageContent>
        <ReceiptsClient
          initialData={data}
          initialFilters={{
            status,
            direction,
            search,
            showOnlyOutstanding,
            page,
            sortBy,
            sortDirection,
          }}
        />
      </PageContent>
    </PageWrapper>
  )
}
