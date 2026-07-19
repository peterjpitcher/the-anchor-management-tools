import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

// Bare auth gate for the whole /checklists tree (staff screen and the /manage subtree).
// The staff pages and the manage layout each render their own header/nav, so this stays a
// gate only, to avoid a double header on the nested management pages.
export default async function ChecklistsLayout({ children }: { children: React.ReactNode }) {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) redirect('/unauthorized')

  return <>{children}</>
}
