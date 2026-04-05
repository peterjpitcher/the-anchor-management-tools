import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

export default async function MgdPage() {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <PageLayout
      title="Machine Games Duty"
      subtitle="Record machine collections and track quarterly HMRC returns."
    >
      <p className="text-muted-foreground">No collections recorded yet — record your first machine collection.</p>
    </PageLayout>
  )
}
