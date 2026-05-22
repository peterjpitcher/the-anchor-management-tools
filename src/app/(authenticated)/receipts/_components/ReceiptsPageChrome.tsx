import type { ReactNode } from 'react'
import { PageHeader, SectionNav } from '@/ds'
import { getReceiptsActiveId, getReceiptsNavItems } from '../receiptsNavItems'

type ReceiptNavView =
  | 'workspace'
  | 'monthly'
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

export function ReceiptsPageChrome({
  title,
  subtitle,
  navState,
  actions,
  children,
}: ReceiptsPageChromeProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Receipts' }]}
        title={title}
        subtitle={subtitle}
        actions={actions}
        className="mb-0"
      />
      <SectionNav items={getReceiptsNavItems()} activeId={getReceiptsActiveId(navState)} />
      {children}
    </div>
  )
}
