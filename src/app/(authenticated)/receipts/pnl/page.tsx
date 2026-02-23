import { getPlDashboardData } from '@/app/actions/pnl'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptsNavItems } from '../receiptsNavItems'

export const runtime = 'nodejs'

export default async function ReceiptsPnlPage() {
  const [canView, canExport] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'export'),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const data = await getPlDashboardData()

  return (
    <PageLayout
      title="P&L Targets"
      subtitle="Compare actual results to Shadow P&L targets across key timeframes."
      backButton={{ label: 'Back to Receipts', href: '/receipts' }}
      navItems={getReceiptsNavItems({ view: 'pnl' })}
    >
      <Card>
        <PnlClient initialData={data} canExport={canExport} />
      </Card>
    </PageLayout>
  )
}
