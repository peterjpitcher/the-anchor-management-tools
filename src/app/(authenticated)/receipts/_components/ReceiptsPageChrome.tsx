import type { ReactNode } from 'react'
import { PageHeader, SectionNav } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptsActiveId, getReceiptsNavItems } from '../receiptsNavItems'

type ReceiptNavView =
  | 'workspace'
  | 'monthly'
  | 'bank-balance'
  | 'vendors'
  | 'pnl'
  | 'bulk'
  | 'missing-expense'

type ReceiptsPageChromeProps = {
  title: string
  subtitle?: string
  navState:
    | {
        view: 'workspace'
        missingVendorOnly?: boolean
        missingExpenseOnly?: boolean
      }
    | {
        view: Exclude<ReceiptNavView, 'workspace'>
      }
  actions?: ReactNode
  children: ReactNode
}

export async function ReceiptsPageChrome({
  title,
  subtitle,
  navState,
  actions,
  children,
}: ReceiptsPageChromeProps) {
  // Bulk classification redirects to /unauthorized without `receipts:manage`,
  // so a view-only user should never be shown the tab in the first place.
  const canManage = await checkUserPermission('receipts', 'manage')

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Receipts' }]}
        title={title}
        subtitle={subtitle}
        actions={actions}
        className="mb-0"
      />
      <SectionNav items={getReceiptsNavItems({ canManage })} activeId={getReceiptsActiveId(navState)} />
      {children}
    </div>
  )
}
