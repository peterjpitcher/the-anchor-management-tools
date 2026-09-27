import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherDetail, getHandoutContext } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import { VoucherDetailClient, type VoucherDetailLayout } from './VoucherDetailClient'

export const dynamic = 'force-dynamic'

export default async function VoucherDetailPage({
  params,
}: {
  params: Promise<{ number: string }>
}) {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const { number } = await params
  const voucherNumber = decodeURIComponent(number)
  const [detailResult, contextResult] = await Promise.all([
    getVoucherDetail(voucherNumber),
    getHandoutContext(),
  ])

  // The voucher number is the title whether or not it loaded. A child page: no tab row, and
  // the back button returns to the ledger (the All Vouchers tab, titled Vouchers) it was opened
  // from. The loaded page adds the voucher's actions to this header (VoucherDetailClient).
  const layoutProps: VoucherDetailLayout = {
    title: detailResult.data?.voucher.voucherNumber ?? voucherNumber,
    subtitle: detailResult.data?.type?.displayTitle ?? detailResult.data?.voucher.typeId,
    backButton: { label: 'Back to Vouchers', href: '/vouchers/all' },
  }

  if (detailResult.error || !detailResult.data) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load this voucher">
          {detailResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <VoucherDetailClient
      layout={layoutProps}
      detail={detailResult.data}
      staff={contextResult.data?.staff ?? []}
    />
  )
}
