import { getPlDashboardData } from '@/app/actions/pnl'
import { Card } from '@/ds'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'

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
    <ReceiptsPageChrome
      title="P&L Targets"
      subtitle="Compare actual results to Shadow P&L targets across key timeframes."
      navState={{ view: 'pnl' }}
    >
      <Card>
        <PnlClient initialData={data} canExport={canExport} />
      </Card>
    </ReceiptsPageChrome>
  )
}
