import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptBankBalanceHistory } from '@/app/actions/receipts'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'
import { BankBalanceClient } from './BankBalanceClient'

export const runtime = 'nodejs'

export default async function ReceiptsBankBalancePage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) redirect('/unauthorized')

  const history = await getReceiptBankBalanceHistory()

  return (
    <ReceiptsPageChrome
      title="Bank balance"
      subtitle="See how the account balance has moved across imported bank statements."
      navState={{ view: 'bank-balance' }}
    >
      <BankBalanceClient points={history.points} sourceRowCount={history.sourceRowCount} />
    </ReceiptsPageChrome>
  )
}
