import type { ReactNode } from 'react'
import { PageLayout } from '@/ds'
import { receiptsNav, type ReceiptsNavState } from '../_shared/nav'

type ReceiptsPageChromeProps = {
  /** One short line saying what this tab is for. The title is always the section name. */
  subtitle: string
  navState: ReceiptsNavState
  /**
   * Whether this person has `receipts:manage`. Bulk classification redirects to /unauthorized
   * without it, so a view-only user is never shown that tab. The page resolves it on the server.
   */
  canManage: boolean
  /** Page-level buttons: secondary first, primary last, size="sm". */
  headerActions?: ReactNode
  children: ReactNode
}

/**
 * The page chrome of every Receipts tab: PageLayout titled "Receipts" with the Receipts tab row.
 * It has no server-only code, so a server page can render it, and so can a client component that
 * needs stateful header actions (the bank balance range switch).
 */
export function ReceiptsPageChrome({
  subtitle,
  navState,
  canManage,
  headerActions,
  children,
}: ReceiptsPageChromeProps): React.JSX.Element {
  return (
    <PageLayout
      title="Receipts"
      subtitle={subtitle}
      navItems={receiptsNav(navState, { canManage })}
      headerActions={headerActions}
    >
      {children}
    </PageLayout>
  )
}
