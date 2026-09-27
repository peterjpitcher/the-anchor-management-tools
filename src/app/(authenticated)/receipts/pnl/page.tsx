import { getPlDashboardData } from '@/app/actions/pnl'
import PnlClient from '@/app/(authenticated)/receipts/_components/PnlClient'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

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

  // PnlClient renders the Receipts chrome, so the timeframe switch and exports sit in the header.
  return <PnlClient initialData={data} canExport={canExport} canManage={canManage} />
}
