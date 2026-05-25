import { getReceiptVendorSummary, getReceiptVendorWatchlist } from '@/app/actions/receipts'
import { Card } from '@/ds'
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

  const [vendors, watchlist] = await Promise.all([
    getReceiptVendorSummary(12),
    getReceiptVendorWatchlist(),
  ])

  return (
    <ReceiptsPageChrome
      title="Vendor spending trends"
      subtitle="See which suppliers are rising in cost and where spend is stable."
      navState={{ view: 'vendors' }}
    >
      {vendors.length === 0 ? (
        <Card variant="bordered">
          <p className="text-sm text-gray-500">No vendor data available yet. Import statements to see trends.</p>
        </Card>
      ) : (
        <VendorSummaryGrid vendors={vendors} initialWatchlist={watchlist} />
      )}
    </ReceiptsPageChrome>
  )
}
