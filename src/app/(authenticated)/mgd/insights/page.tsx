import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMgdInsights } from '@/app/actions/mgd'
import { PageLayout } from '@/ds'
import { Alert } from '@/ds'
import { Card } from '@/ds'
import { MgdInsightsClient } from './_components/MgdInsightsClient'
import type { HeaderNavItem } from '@/ds'

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
