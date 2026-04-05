import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

export default async function MileagePage() {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <PageLayout
      title="Mileage"
      subtitle="Track business trips for HMRC mileage reimbursement."
    >
      <p className="text-muted-foreground">No trips recorded yet — add your first trip.</p>
    </PageLayout>
  )
}
