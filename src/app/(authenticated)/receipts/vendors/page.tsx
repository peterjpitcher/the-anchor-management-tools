import { getReceiptVendorReviews, getReceiptVendorWatchlist } from '@/app/actions/receipts'
import VendorSummaryGrid from './_components/VendorSummaryGrid'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'

export const runtime = 'nodejs'

export default async function ReceiptsVendorsPage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  // The movement panel loads its own data client-side, so the 12 month vendor
  // summary that used to be fetched here was paid for and then thrown away.
  const [watchlist, reviews] = await Promise.all([
    getReceiptVendorWatchlist(),
    getReceiptVendorReviews(),
  ])

  return (
    <ReceiptsPageChrome
      title="Vendor spending trends"
      subtitle="See which suppliers are rising in cost and where spend is stable."
      navState={{ view: 'vendors' }}
    >
      <VendorSummaryGrid initialWatchlist={watchlist} initialReviews={reviews} />
    </ReceiptsPageChrome>
  )
}
