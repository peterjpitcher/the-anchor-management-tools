import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

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

export function getReceiptsNavItems(state: ReceiptNavState): HeaderNavItem[] {
  const view = state.view
  const missingVendorOnly = view === 'workspace' ? Boolean(state.missingVendorOnly) : false
  const missingExpenseOnly = view === 'workspace' ? Boolean(state.missingExpenseOnly) : false

  return [
    {
      label: 'Workspace',
      href: '/receipts',
      active: view === 'workspace' && !missingVendorOnly && !missingExpenseOnly,
    },
    {
      label: 'Monthly overview',
      href: '/receipts/monthly',
      active: view === 'monthly',
    },
    {
      label: 'Vendor trends',
      href: '/receipts/vendors',
      active: view === 'vendors',
    },
    {
      label: 'P&L dashboard',
      href: '/receipts/pnl',
      active: view === 'pnl',
    },
    {
      label: 'Bulk classification',
      href: '/receipts/bulk',
      active: view === 'bulk',
    },
    {
      label: 'Needs vendor',
      href: '/receipts?needsVendor=1',
      active: view === 'workspace' && missingVendorOnly,
    },
    {
      label: 'Needs expense',
      href: '/receipts?needsExpense=1',
      active: view === 'workspace' && missingExpenseOnly,
    },
    {
      label: 'Missing expense summary',
      href: '/receipts/missing-expense',
      active: view === 'missing-expense',
    },
  ]
}

