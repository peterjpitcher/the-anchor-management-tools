import { redirect } from 'next/navigation'
import { Alert } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { currentUserCanGovernReceiptRules } from '@/app/actions/receipts'
import { getReceiptVendorDirectory } from '@/app/actions/receipt-vendors'
import { ReceiptsPageChrome } from '../../_components/ReceiptsPageChrome'
import { VendorDirectoryClient } from './_components/VendorDirectoryClient'

export const runtime = 'nodejs'

export default async function ReceiptsVendorManagePage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'manage'),
  ])
  if (!canView) {
    redirect('/unauthorized')
  }

  const [canGovern, result] = await Promise.all([
    canManage ? currentUserCanGovernReceiptRules() : Promise.resolve(false),
    getReceiptVendorDirectory(),
  ])

  if (!result.directory) {
    return (
      <ReceiptsPageChrome
        subtitle="The vendor list: confirm, rename and merge vendors"
        navState={{ view: 'vendors' }}
        canManage={canManage}
      >
        <Alert tone="danger" title="The vendor list could not be loaded">
          {result.error ?? 'Try again in a moment.'}
        </Alert>
      </ReceiptsPageChrome>
    )
  }

  return <VendorDirectoryClient directory={result.directory} canManage={canManage} canGovern={canGovern} />
}
