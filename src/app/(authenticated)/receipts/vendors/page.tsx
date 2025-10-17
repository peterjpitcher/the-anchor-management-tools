import { getReceiptVendorSummary } from '@/app/actions/receipts'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
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
    <PageWrapper>
      <PageHeader
        title="Vendor spending trends"
        subtitle="See which suppliers are rising in cost and where spend is stable."
      />
      <PageContent>
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/receipts"
              className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              ← Back to receipts
            </Link>
          </div>

          {vendors.length === 0 ? (
            <Card variant="bordered">
              <p className="text-sm text-gray-500">No vendor data available yet. Import statements to see trends.</p>
            </Card>
          ) : (
            <VendorSummaryGrid vendors={vendors} />
          )}
        </div>
      </PageContent>
    </PageWrapper>
  )
}
