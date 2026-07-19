import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageHeader } from '@/ds'
import { ManageNav } from './_components/ManageNav'

export default async function ChecklistsManageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) redirect('/unauthorized')

  return (
    <div>
      <PageHeader
        title="Checklists Management"
        subtitle="Setup, oversight and spot checks"
      />
      <ManageNav />
      {children}
    </div>
  )
}
