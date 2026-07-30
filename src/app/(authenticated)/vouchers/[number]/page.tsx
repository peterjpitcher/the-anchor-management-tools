import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherDetail, getHandoutContext } from '@/app/actions/vouchers'
import { PageLayout, Alert, LinkButton } from '@/ds'
import { VOUCHER_SECTION_NAV } from '../_shared/voucher-ui'
import { VoucherDetailClient } from './VoucherDetailClient'

export const dynamic = 'force-dynamic'

export default async function VoucherDetailPage({
  params,
}: {
  params: Promise<{ number: string }>
}) {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const { number } = await params
  const [detailResult, contextResult] = await Promise.all([
    getVoucherDetail(decodeURIComponent(number)),
    getHandoutContext(),
  ])

  if (detailResult.error || !detailResult.data) {
    return (
      <PageLayout
        title="Voucher"
        navItems={VOUCHER_SECTION_NAV}
        backButton={{ label: 'Back to the ledger', href: '/vouchers/all' }}
      >
        <div className="space-y-4">
          <Alert tone="danger" title="Could not load this voucher">
            {detailResult.error ?? 'Something went wrong. Refresh to try again.'}
          </Alert>
          <LinkButton href="/vouchers/all" variant="secondary">
            Back to the ledger
          </LinkButton>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title={detailResult.data.voucher.voucherNumber}
      subtitle={detailResult.data.type?.displayTitle}
      navItems={VOUCHER_SECTION_NAV}
      backButton={{ label: 'Back to the ledger', href: '/vouchers/all' }}
    >
      <VoucherDetailClient
        detail={detailResult.data}
        staff={contextResult.data?.staff ?? []}
      />
    </PageLayout>
  )
}
