import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMileageInsights } from '@/app/actions/mileage'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { MileageInsightsClient } from './_components/MileageInsightsClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]

export default async function MileageInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getMileageInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout title="Mileage" subtitle="Insights" navItems={navItems}>
        <Alert variant="error" title="Error loading insights" description={result.error ?? 'Unknown error'} />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Mileage" subtitle="Insights" navItems={navItems}>
      <MileageInsightsClient initialData={result.data} />
    </PageLayout>
  )
}
