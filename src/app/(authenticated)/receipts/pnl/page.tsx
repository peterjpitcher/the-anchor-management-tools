import { getPlDashboardData } from '@/app/actions/pnl'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'

export const runtime = 'nodejs'

export default async function ReceiptsPnlPage() {
  const [canView, canExport, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'export'),
    checkUserPermission('receipts', 'manage'),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const data = await getPlDashboardData()

  return (
    <ReceiptsPageChrome
      title="Business Health"
      subtitle="Compare cash-up sales and receipt expenses against the Greene King Shadow P&L."
      navState={{ view: 'pnl' }}
    >
      <PnlClient initialData={data} canExport={canExport} canManage={canManage} />
    </ReceiptsPageChrome>
  )
}
