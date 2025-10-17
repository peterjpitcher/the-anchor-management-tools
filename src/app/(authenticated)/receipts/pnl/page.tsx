import { getPlDashboardData } from '@/app/actions/pnl'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export const runtime = 'nodejs'

export default async function ReceiptsPnlPage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const data = await getPlDashboardData()

  return (
    <PageWrapper>
      <PageHeader
        title="P&L Targets"
        subtitle="Compare actual results to your targets across key timeframes."
        backButton={{ label: 'Back to Receipts', href: '/receipts' }}
      />
      <PageContent>
        <Card>
          <PnlClient initialData={data} />
        </Card>
      </PageContent>
    </PageWrapper>
  )
}
