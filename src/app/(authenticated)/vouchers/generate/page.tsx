import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherSummary, listVoucherTypes } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import { VOUCHERS_NAV } from '../_shared/nav'
import { GenerateClient } from './GenerateClient'

export const dynamic = 'force-dynamic'

export default async function GenerateVouchersPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const params = await searchParams
  const [typesResult, summaryResult] = await Promise.all([listVoucherTypes(), getVoucherSummary()])

  // One form and no table, so the narrow form width. A top-level tab: no back button.
  const layoutProps = {
    title: 'Vouchers',
    subtitle: 'Generate: a print batch of physical voucher cards',
    navItems: VOUCHERS_NAV,
    containerSize: 'md' as const,
  }

  if (typesResult.error || !typesResult.data) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load voucher types">
          {typesResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const stockByType = new Map(
    (summaryResult.data?.stock ?? []).map((row) => [row.typeId, row.inStock])
  )
  const types = typesResult.data
    .filter((type) => type.active)
    .map((type) => ({
      typeId: type.id,
      displayTitle: type.displayTitle,
      inStock: stockByType.get(type.id) ?? 0,
    }))

  return (
    <PageLayout {...layoutProps}>
      <GenerateClient types={types} initialBatchId={params.batch ?? null} />
    </PageLayout>
  )
}
