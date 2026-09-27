import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

/**
 * The section gate only. Each Cashing Up page renders its own PageLayout with CASHING_UP_NAV
 * (_shared/nav.ts), so the active tab follows the path and pages can put actions in the header.
 */
export default async function CashingUpLayout({ children }: { children: React.ReactNode }) {
  const canView = await checkUserPermission('cashing_up', 'view')
  if (!canView) redirect('/unauthorized')

  return <>{children}</>
}
