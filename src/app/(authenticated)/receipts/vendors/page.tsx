import { getReceiptVendorSummary } from '@/app/actions/receipts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import Link from 'next/link'
import VendorSummaryGrid from './_components/VendorSummaryGrid'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export const runtime = 'nodejs'

export default async function ReceiptsVendorsPage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const vendors = await getReceiptVendorSummary(12)

  return (
    <PageLayout
      title="Vendor spending trends"
      subtitle="See which suppliers are rising in cost and where spend is stable."
      backButton={{ label: 'Back to receipts', href: '/receipts' }}
    >
      {vendors.length === 0 ? (
        <Card variant="bordered">
          <p className="text-sm text-gray-500">No vendor data available yet. Import statements to see trends.</p>
        </Card>
      ) : (
        <VendorSummaryGrid vendors={vendors} />
      )}
    </PageLayout>
  )
}
