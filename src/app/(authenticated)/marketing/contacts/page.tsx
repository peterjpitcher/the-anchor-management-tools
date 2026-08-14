import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import {
  listBusinessContacts,
  listBusinessContactsWithEngagement,
  listMarketingClusters,
  listMarketingTags,
} from '@/app/actions/marketing-contacts'
import { Alert, PageLayout } from '@/ds'
import type { EligibilityStatus, MarketingStatus } from '@/types/marketing'

import { MARKETING_SECTION_NAV } from '../_shared/marketing-ui'
import { ContactsClient } from './ContactsClient'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

const ELIGIBILITY_VALUES: EligibilityStatus[] = ['pending_review', 'eligible', 'excluded']
const STATUS_VALUES: MarketingStatus[] = ['subscribed', 'unsubscribed', 'bounced', 'complained']

export default async function MarketingContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const canView = await checkUserPermission('marketing', 'view')
  if (!canView) redirect('/unauthorized')

  const [canEdit, canCreate] = await Promise.all([
    checkUserPermission('marketing', 'edit'),
    checkUserPermission('marketing', 'create'),
  ])

  const params = await searchParams
  const search = firstValue(params.search).trim()
  const tag = firstValue(params.tag).trim()
  const cluster = firstValue(params.cluster).trim()
  const eligibilityRaw = firstValue(params.eligibility).trim() as EligibilityStatus
  const statusRaw = firstValue(params.status).trim() as MarketingStatus
  const eligibility = ELIGIBILITY_VALUES.includes(eligibilityRaw) ? eligibilityRaw : undefined
  const status = STATUS_VALUES.includes(statusRaw) ? statusRaw : undefined
  const pageNumber = Number.parseInt(firstValue(params.page), 10)
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1

  const [listResult, tagsResult, clustersResult, pendingResult] = await Promise.all([
    listBusinessContactsWithEngagement({
      search: search || undefined,
      tags: tag ? [tag] : undefined,
      cluster: cluster || undefined,
      eligibility,
      status,
      page,
      pageSize: PAGE_SIZE,
    }),
    listMarketingTags(),
    listMarketingClusters(),
    // Only the total matters here, so ask for the smallest page the action allows.
    listBusinessContacts({ eligibility: 'pending_review', page: 1, pageSize: 1 }),
  ])

  if (listResult.error || !listResult.data) {
    return (
      <PageLayout title="Marketing" subtitle="Contacts" navItems={MARKETING_SECTION_NAV}>
        <Alert tone="danger" title="Could not load contacts">
          {listResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <ContactsClient
      initialContacts={listResult.data.contacts}
      initialTotal={listResult.data.total}
      initialPage={page}
      pageSize={PAGE_SIZE}
      initialFilters={{
        search,
        tag,
        cluster,
        eligibility: eligibility ?? '',
        status: status ?? '',
      }}
      tags={tagsResult.data ?? []}
      clusters={clustersResult.data ?? []}
      pendingReviewCount={pendingResult.data?.total ?? 0}
      canEdit={canEdit}
      canCreate={canCreate}
    />
  )
}
