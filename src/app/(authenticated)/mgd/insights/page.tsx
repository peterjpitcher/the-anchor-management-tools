import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMgdInsights, type MgdInsightsData } from '@/app/actions/mgd'
import { Alert, PageLayout } from '@/ds'
import { MGD_INSIGHTS_LAYOUT } from '../_shared/nav'
import { MgdInsightsClient } from './_components/MgdInsightsClient'

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
      <PageLayout {...MGD_INSIGHTS_LAYOUT}>
        <Alert tone="danger" title="Error loading insights">{error}</Alert>
      </PageLayout>
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

  // The client renders the PageLayout, so the period switch can sit in the header.
  return (
    <MgdInsightsClient
      initialData={{
        quarterly: quarterlyResult.data ?? emptyData,
        annually: annuallyResult.data ?? emptyData,
        all: allResult.data ?? emptyData,
      }}
    />
  )
}
