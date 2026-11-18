import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import { listMarketingTags } from '@/app/actions/marketing-contacts'

import { NewCampaignClient } from './NewCampaignClient'

export const dynamic = 'force-dynamic'

export default async function NewMarketingCampaignPage() {
  const [canView, canCreate, canSend] = await Promise.all([
    checkUserPermission('marketing', 'view'),
    checkUserPermission('marketing', 'create'),
    checkUserPermission('marketing', 'send'),
  ])
  if (!canView) redirect('/unauthorized')
  if (!canCreate) redirect('/unauthorized')

  const tagsResult = await listMarketingTags()

  return <NewCampaignClient tags={tagsResult.data ?? []} canSend={canSend} />
}
