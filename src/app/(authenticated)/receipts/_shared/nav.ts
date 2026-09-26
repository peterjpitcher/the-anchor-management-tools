import type { HeaderNavItem } from '@/ds'

/**
 * The Receipts tab row. Pure module, safe to import from server and client components.
 *
 * Two tabs are the workspace with a filter on (Needs Vendor, Needs Expense), so they share the
 * workspace's path and the path alone cannot say which tab is current. Every page therefore
 * passes the view it shows, and receiptsNav() marks exactly one tab active.
 */

type ReceiptsView =
  | 'workspace'
  | 'monthly'
  | 'bank-balance'
  | 'vendors'
  | 'pnl'
  | 'bulk'
  | 'missing-expense'

export type ReceiptsNavState =
  | { view: 'workspace'; missingVendorOnly?: boolean; missingExpenseOnly?: boolean }
  | { view: Exclude<ReceiptsView, 'workspace'> }

type ReceiptsTabId = ReceiptsView | 'needs-vendor' | 'needs-expense'

/** Where each tab points. The two filtered workspace tabs carry their filter in the query. */
const RECEIPTS_TAB_HREF: Record<ReceiptsTabId, string> = {
  workspace: '/receipts',
  monthly: '/receipts/monthly',
  'bank-balance': '/receipts/bank-balance',
  vendors: '/receipts/vendors',
  pnl: '/receipts/pnl',
  bulk: '/receipts/bulk',
  'needs-vendor': '/receipts?needsVendor=1',
  'needs-expense': '/receipts?needsExpense=1',
  'missing-expense': '/receipts/missing-expense',
}

export const RECEIPTS_NAV: HeaderNavItem[] = [
  { label: 'Workspace', href: RECEIPTS_TAB_HREF.workspace },
  { label: 'Monthly', href: RECEIPTS_TAB_HREF.monthly },
  { label: 'Bank Balance', href: RECEIPTS_TAB_HREF['bank-balance'] },
  { label: 'Vendors', href: RECEIPTS_TAB_HREF.vendors },
  { label: 'Business Health', href: RECEIPTS_TAB_HREF.pnl },
  { label: 'Bulk', href: RECEIPTS_TAB_HREF.bulk },
  { label: 'Needs Vendor', href: RECEIPTS_TAB_HREF['needs-vendor'] },
  { label: 'Needs Expense', href: RECEIPTS_TAB_HREF['needs-expense'] },
  // Distinct from "Needs Expense": that filters the workspace list, this is the vendor-level
  // summary of where the gaps are.
  { label: 'Expense Gaps', href: RECEIPTS_TAB_HREF['missing-expense'] },
]

function receiptsActiveTab(state: ReceiptsNavState): ReceiptsTabId {
  if (state.view === 'workspace' && state.missingVendorOnly) return 'needs-vendor'
  if (state.view === 'workspace' && state.missingExpenseOnly) return 'needs-expense'
  return state.view
}

/**
 * RECEIPTS_NAV for one page, with its tab marked active. Bulk classification redirects without
 * `receipts:manage`, so a view-only user is never shown that tab.
 */
export function receiptsNav(state: ReceiptsNavState, { canManage = true }: { canManage?: boolean } = {}): HeaderNavItem[] {
  const activeHref = RECEIPTS_TAB_HREF[receiptsActiveTab(state)]
  return RECEIPTS_NAV
    .filter((item) => canManage || item.href !== RECEIPTS_TAB_HREF.bulk)
    .map((item) => ({ ...item, active: item.href === activeHref }))
}
