import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptBankBalanceHistory } from '@/app/actions/receipts'
import { BankBalanceClient } from './BankBalanceClient'

export const runtime = 'nodejs'

export default async function ReceiptsBankBalancePage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'manage'),
  ])
  if (!canView) redirect('/unauthorized')

  const history = await getReceiptBankBalanceHistory()

  // BankBalanceClient renders the Receipts chrome, so its range switch can sit in the header.
  return <BankBalanceClient points={history.points} sourceRowCount={history.sourceRowCount} canManage={canManage} />
}
