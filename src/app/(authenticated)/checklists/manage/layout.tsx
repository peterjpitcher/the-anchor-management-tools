import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

// Permission gate for the manager tabs. Each page renders its own PageLayout with
// CHECKLISTS_MANAGE_LAYOUT (checklists/_shared/nav.ts), so a tab can put its actions in the
// header and the active tab comes from the path.
export default async function ChecklistsManageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) redirect('/unauthorized')

  return <>{children}</>
}
