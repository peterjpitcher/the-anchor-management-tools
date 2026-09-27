import { getReceiptVendorReviews, getReceiptVendorWatchlist } from '@/app/actions/receipts'
import VendorSummaryGrid from './_components/VendorSummaryGrid'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export const runtime = 'nodejs'

export default async function ReceiptsVendorsPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'manage'),
  ])
  if (!canView) {
    redirect('/unauthorized')
  }

  // The movement panel loads its own data client-side, so the 12 month vendor
  // summary that used to be fetched here was paid for and then thrown away.
  const [watchlist, reviews] = await Promise.all([
    getReceiptVendorWatchlist(),
    getReceiptVendorReviews(),
  ])

  // VendorSummaryGrid renders the Receipts chrome, so its comparison switch can sit in the header.
  return <VendorSummaryGrid initialWatchlist={watchlist} initialReviews={reviews} canManage={canManage} />
}
