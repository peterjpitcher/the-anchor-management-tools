import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import {
  getMarketingCampaign,
  getMarketingCampaignStats,
  listMarketingCampaignRecipients,
} from '@/app/actions/marketing-campaigns'
import { Alert, PageLayout } from '@/ds'
import { marketingContentSchema } from '@/lib/email/marketing/registry'
import { renderCampaignHtml } from '@/lib/email/marketing/render'

import { MARKETING_SECTION_NAV } from '../../_shared/marketing-ui'
import { CampaignDetailClient } from './CampaignDetailClient'

export const dynamic = 'force-dynamic'

const RECIPIENTS_PAGE_SIZE = 50

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function MarketingCampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const canView = await checkUserPermission('marketing', 'view')
  if (!canView) redirect('/unauthorized')

  const canSend = await checkUserPermission('marketing', 'send')

  const { id } = await params
  const query = await searchParams
  const pageNumber = Number.parseInt(firstValue(query.page), 10)
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1

  const [campaignResult, statsResult, recipientsResult] = await Promise.all([
    getMarketingCampaign(id),
    getMarketingCampaignStats(id),
    listMarketingCampaignRecipients(id, { page, pageSize: RECIPIENTS_PAGE_SIZE }),
  ])

  if (campaignResult.error || !campaignResult.data) {
    return (
      <PageLayout title="Campaign" navItems={MARKETING_SECTION_NAV}>
        <Alert tone="danger" title="Could not load this campaign">
          {campaignResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const campaign = campaignResult.data

  // Rendered on the server so the renderer, which is server-only, never reaches the browser.
  // The schema is parsed rather than trusted: content that predates a renderer change can be
  // stored and still fail to render, and a blank preview is better than a crashed page.
  let previewHtml: string | null = null
  let previewError: string | null = null
  const parsedContent = marketingContentSchema.safeParse(campaign.content)
  if (parsedContent.success) {
    try {
      previewHtml = renderCampaignHtml(parsedContent.data)
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'The content could not be rendered'
    }
  } else {
    previewError =
      'The stored content no longer matches what the renderer accepts, so there is nothing to preview.'
  }

  return (
    <CampaignDetailClient
      campaign={campaign}
      stats={statsResult.data ?? null}
      statsError={statsResult.error ?? null}
      recipients={recipientsResult.data?.recipients ?? []}
      recipientsTotal={recipientsResult.data?.total ?? 0}
      recipientsPage={page}
      recipientsPageSize={RECIPIENTS_PAGE_SIZE}
      recipientsError={recipientsResult.error ?? null}
      previewHtml={previewHtml}
      previewError={previewError}
      canSend={canSend}
    />
  )
}
