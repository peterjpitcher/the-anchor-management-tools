import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMgdInsights } from '@/app/actions/mgd'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Card } from '@/components/ui-v2/layout/Card'
import { MgdInsightsClient } from './_components/MgdInsightsClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Collections', href: '/mgd' },
  { label: 'Insights', href: '/mgd/insights' },
]

export default async function MgdInsightsPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getMgdInsights('quarterly')

  if ('error' in result) {
    return (
      <PageLayout title="Machine Games Duty" subtitle="Insights" navItems={navItems}>
        <Card>
          <Alert variant="error" title="Error loading insights" description={result.error} />
        </Card>
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Machine Games Duty" subtitle="Insights" navItems={navItems}>
      <MgdInsightsClient initialData={result.data!} />
    </PageLayout>
  )
}
