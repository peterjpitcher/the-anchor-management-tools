import ReceiptBulkReviewClient from '@/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient'
import { getReceiptBulkReviewData } from '@/app/actions/receipts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { receiptTransactionStatusSchema } from '@/lib/validation'
import type { ReceiptTransaction } from '@/types/database'
import { getReceiptsNavItems } from '../receiptsNavItems'

const STATUS_VALUES = new Set(receiptTransactionStatusSchema.options)

type BulkStatus = ReceiptTransaction['status']

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function ReceiptsBulkPage({ searchParams }: PageProps) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const resolvedParams = searchParams ? await searchParams : {}

  const limitParam = typeof resolvedParams?.limit === 'string' ? Number.parseInt(resolvedParams.limit, 10) : NaN
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : undefined

  const rawStatuses = typeof resolvedParams?.statuses === 'string' ? resolvedParams.statuses.split(',') : []
  const statuses: BulkStatus[] | undefined = rawStatuses.length
    ? rawStatuses
        .map((status) => status.trim())
        .filter((status): status is BulkStatus => STATUS_VALUES.has(status as BulkStatus))
    : undefined

  const onlyUnclassified = resolvedParams?.all === '1' ? false : true
  const useFuzzyGrouping = resolvedParams?.fuzzy === '1'

  const data = await getReceiptBulkReviewData({
    limit,
    statuses,
    onlyUnclassified,
    useFuzzyGrouping,
  })

  const filters = {
    limit: data.config.limit,
    statuses: data.config.statuses,
    onlyUnclassified: data.config.onlyUnclassified,
  }

  return (
    <PageLayout
      title="Bulk classification"
      subtitle="Group similar transactions, confirm AI suggestions, and roll out rules in one sweep."
      backButton={{ label: 'Back to receipts', href: '/receipts' }}
      navItems={getReceiptsNavItems({ view: 'bulk' })}
    >
      <ReceiptBulkReviewClient initialData={data} initialFilters={filters} />
    </PageLayout>
  )
}
