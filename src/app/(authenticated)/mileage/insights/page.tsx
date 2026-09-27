import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMileageInsights } from '@/app/actions/mileage'
import { Alert, PageLayout } from '@/ds'
import { MILEAGE_INSIGHTS_LAYOUT } from '../_shared/nav'
import { MileageInsightsClient } from './_components/MileageInsightsClient'

export default async function MileageInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getMileageInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout {...MILEAGE_INSIGHTS_LAYOUT}>
        <Alert tone="danger" title="Error loading insights">{result.error ?? 'Unknown error'}</Alert>
      </PageLayout>
    )
  }

  // The client renders the PageLayout, so the period switch can sit in the header.
  return <MileageInsightsClient initialData={result.data} />
}
