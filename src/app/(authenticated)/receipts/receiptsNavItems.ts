type ReceiptNavView =
  | 'workspace'
  | 'monthly'
  | 'bank-balance'
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

type ReceiptsNavOptions = {
  /** Bulk classification requires `receipts:manage`; the page redirects without it. */
  canManage?: boolean
}

export function getReceiptsNavItems({ canManage = true }: ReceiptsNavOptions = {}) {
  const items = [
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
      id: 'bank-balance',
      label: 'Bank balance',
      href: '/receipts/bank-balance',
    },
    {
      id: 'vendors',
      label: 'Vendors',
      href: '/receipts/vendors',
    },
    {
      id: 'pnl',
      // Matches the page title, which reads "Business Health".
      label: 'Business health',
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
      // Distinct from "Needs expense": that filters the workspace list, this
      // is the vendor-level summary of where the gaps are.
      id: 'missing-expense',
      label: 'Expense gaps',
      href: '/receipts/missing-expense',
    },
  ]

  return canManage ? items : items.filter((item) => item.id !== 'bulk')
}
