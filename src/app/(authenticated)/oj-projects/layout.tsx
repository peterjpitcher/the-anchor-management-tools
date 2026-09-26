import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

// Permission gate for the section. Each page renders its own PageLayout with
// OJ_PROJECTS_LAYOUT (oj-projects/_shared/nav.ts), so a tab can put its "New X" button in the
// header and the active tab comes from the path.
export default async function OJProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) redirect('/unauthorized')

  return <>{children}</>
}
