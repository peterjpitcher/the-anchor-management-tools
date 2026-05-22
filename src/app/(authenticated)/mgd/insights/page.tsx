import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMgdInsights, type MgdInsightsData } from '@/app/actions/mgd'
import { PageHeader, SectionNav } from '@/ds'
import { Alert } from '@/ds'
import { Card } from '@/ds'
import { MgdInsightsClient } from './_components/MgdInsightsClient'

const MGD_SECTION_NAV = [
  { id: 'collections', label: 'Collections', href: '/mgd' },
  { id: 'insights', label: 'Insights', href: '/mgd/insights' },
]

export default async function MgdInsightsPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) redirect('/unauthorized')

  const [quarterlyResult, annuallyResult, allResult] = await Promise.all([
    getMgdInsights('quarterly'),
    getMgdInsights('annually'),
    getMgdInsights('all'),
  ])

  if ('error' in quarterlyResult || 'error' in annuallyResult || 'error' in allResult) {
    const error =
      ('error' in quarterlyResult ? quarterlyResult.error : '') ||
      ('error' in annuallyResult ? annuallyResult.error : '') ||
      ('error' in allResult ? allResult.error : '')

    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'Finance' }, { label: 'MGD' }]}
          title="Machine Games Duty"
          subtitle="Track collections and quarterly MGD returns"
          className="mb-0"
        />
        <SectionNav items={MGD_SECTION_NAV} activeId="insights" />
        <Card>
          <Alert variant="error" title="Error loading insights" description={error} />
        </Card>
      </div>
    )
  }

  const emptyData: MgdInsightsData = {
    bars: [],
    totals: {
      totalNetTake: 0,
      totalMgd: 0,
      totalVatOnSupplier: 0,
    },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'MGD' }]}
        title="Machine Games Duty"
        subtitle="Track collections and quarterly MGD returns"
        className="mb-0"
      />
      <SectionNav items={MGD_SECTION_NAV} activeId="insights" />
      <MgdInsightsClient
        initialData={{
          quarterly: quarterlyResult.data ?? emptyData,
          annually: annuallyResult.data ?? emptyData,
          all: allResult.data ?? emptyData,
        }}
      />
    </div>
  )
}
