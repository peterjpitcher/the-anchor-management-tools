import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { InsightsClient } from './InsightsClient'

export default async function ShortLinksInsightsPage() {
  const canView = await checkUserPermission('short_links', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  return <InsightsClient />
}
