import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/ds'
import { OJProjectsNav } from './_components/OJProjectsNav'

export default async function OJProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) redirect('/unauthorized')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="OJ Projects"
        subtitle="Project management and time tracking"
      />
      <OJProjectsNav />
      {children}
    </div>
  )
}
