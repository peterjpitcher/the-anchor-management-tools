import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

export default async function MileageDestinationsPage() {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <PageLayout
      title="Saved Destinations"
      subtitle="Manage your frequently visited destinations."
      backButton={{ label: 'Back to mileage', href: '/mileage' }}
    >
      <p className="text-muted-foreground">Loading destinations...</p>
    </PageLayout>
  )
}
