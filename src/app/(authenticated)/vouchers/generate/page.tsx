import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherSummary, listVoucherTypes } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import { VOUCHER_SECTION_NAV } from '../_shared/voucher-ui'
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

  if (typesResult.error || !typesResult.data) {
    return (
      <PageLayout title="Generate vouchers" navItems={VOUCHER_SECTION_NAV}>
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
    <PageLayout
      title="Generate vouchers"
      subtitle="Create a print batch of physical voucher cards. Expiry is written on at hand-out, never at generation."
      navItems={VOUCHER_SECTION_NAV}
      backButton={{ label: 'Back to vouchers', href: '/vouchers' }}
    >
      <GenerateClient types={types} initialBatchId={params.batch ?? null} />
    </PageLayout>
  )
}
