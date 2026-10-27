import { redirect } from 'next/navigation'
import { getPermissionStatus } from '@/app/actions/rbac'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'

// Bare auth gate for the whole /checklists tree (staff screen and the /manage subtree).
// The staff pages and the manage layout each render their own header/nav, so this stays a
// gate only, to avoid a double header on the nested management pages.
export default async function ChecklistsLayout({ children }: { children: React.ReactNode }) {
  const viewStatus = await getPermissionStatus('checklists', 'view')
  // A failed lookup shows a retry screen rather than Access Denied (BK-095).
  if (viewStatus === 'unavailable') return <PermissionsUnavailable />
  if (viewStatus !== 'allowed') redirect('/unauthorized')

  return <>{children}</>
}
