type ReceiptNavView =
  | 'workspace'
  | 'monthly'
  | 'vendors'
  | 'pnl'
  | 'bulk'
  | 'missing-expense'

type ReceiptNavState =
  | {
      view: 'workspace'
      missingVendorOnly?: boolean
      missingExpenseOnly?: boolean
    }
  | {
      view: Exclude<ReceiptNavView, 'workspace'>
    }

export function getReceiptsActiveId(state: ReceiptNavState): string {
  const view = state.view
  const missingVendorOnly = view === 'workspace' ? Boolean(state.missingVendorOnly) : false
  const missingExpenseOnly = view === 'workspace' ? Boolean(state.missingExpenseOnly) : false

  if (view === 'workspace' && missingVendorOnly) return 'needs-vendor'
  if (view === 'workspace' && missingExpenseOnly) return 'needs-expense'
  return view
}

export function getReceiptsNavItems() {
  return [
    {
      id: 'workspace',
      label: 'Workspace',
      href: '/receipts',
    },
    {
      id: 'monthly',
      label: 'Monthly',
      href: '/receipts/monthly',
    },
    {
      id: 'vendors',
      label: 'Vendors',
      href: '/receipts/vendors',
    },
    {
      id: 'pnl',
      label: 'P&L',
      href: '/receipts/pnl',
    },
    {
      id: 'bulk',
      label: 'Bulk',
      href: '/receipts/bulk',
    },
    {
      id: 'needs-vendor',
      label: 'Needs vendor',
      href: '/receipts?needsVendor=1',
    },
    {
      id: 'needs-expense',
      label: 'Needs expense',
      href: '/receipts?needsExpense=1',
    },
    {
      id: 'missing-expense',
      label: 'Missing expense',
      href: '/receipts/missing-expense',
    },
  ]
}
