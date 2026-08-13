import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import { listMarketingTags } from '@/app/actions/marketing-contacts'

import { NewCampaignClient } from './NewCampaignClient'

export const dynamic = 'force-dynamic'

export default async function NewMarketingCampaignPage() {
  const canView = await checkUserPermission('marketing', 'view')
  if (!canView) redirect('/unauthorized')

  const canCreate = await checkUserPermission('marketing', 'create')
  if (!canCreate) redirect('/unauthorized')

  const canSend = await checkUserPermission('marketing', 'send')
  const tagsResult = await listMarketingTags()

  return <NewCampaignClient tags={tagsResult.data ?? []} canSend={canSend} />
}
