import Link from 'next/link'
import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import {
  getMarketingCampaignStats,
  getMarketingSettings,
  listMarketingCampaigns,
} from '@/app/actions/marketing-campaigns'
import {
  Alert,
  Card,
  Empty,
  LinkButton,
  PageLayout,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import type { MarketingCampaignStats } from '@/types/marketing'

import {
  CampaignStatusBadge,
  MARKETING_SECTION_NAV,
  formatCountWithRate,
  formatDateTimeInLondon,
} from './_shared/marketing-ui'
import { UnsubscribeEmailCard } from './UnsubscribeEmailCard'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function MarketingCampaignsPage() {
  const canView = await checkUserPermission('marketing', 'view')
  if (!canView) redirect('/unauthorized')

  const [canCreate, canEdit] = await Promise.all([
    checkUserPermission('marketing', 'create'),
    checkUserPermission('marketing', 'edit'),
  ])

  const [campaignsResult, settingsResult] = await Promise.all([
    listMarketingCampaigns({ page: 1, pageSize: PAGE_SIZE }),
    getMarketingSettings(),
  ])

  if (campaignsResult.error || !campaignsResult.data) {
    return (
      <PageLayout title="Marketing" subtitle="Campaigns" navItems={MARKETING_SECTION_NAV}>
        <Alert tone="danger" title="Could not load campaigns">
          {campaignsResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const campaigns = campaignsResult.data.campaigns
  const settings = settingsResult.data
  const sendingOff = settings ? settings.sendsEnabled === false : false

  // Engagement needs one stats query per campaign, so it is only asked for where a send has
  // actually happened. A draft has nothing to report and would cost a query to say so.
  const statsEntries = await Promise.all(
    campaigns
      .filter((campaign) => campaign.summary.sent > 0)
      .map(async (campaign) => {
        const result = await getMarketingCampaignStats(campaign.id)
        return [campaign.id, result.data ?? null] as const
      }),
  )
  const statsById = new Map<string, MarketingCampaignStats | null>(statsEntries)

  return (
    <PageLayout
      title="Marketing"
      subtitle="Email campaigns to business contacts"
      navItems={MARKETING_SECTION_NAV}
      headerActions={
        canCreate ? (
          <LinkButton href="/marketing/campaigns/new" variant="primary">
            New campaign
          </LinkButton>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {sendingOff && (
          <Alert tone="warning" title="Sending is switched off">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0">
                Nothing will go out, even if a campaign is scheduled. Turn sending back on in
                Settings when you are ready.
              </p>
              <LinkButton href="/marketing/settings" variant="secondary" size="sm">
                Go to Settings
              </LinkButton>
            </div>
          </Alert>
        )}

        {settingsResult.error && (
          <Alert tone="warning" title="Could not check whether sending is switched on">
            {settingsResult.error}. Treat the send switch as unknown until this loads.
          </Alert>
        )}

        {canEdit && <UnsubscribeEmailCard />}

        <Card>
          {campaigns.length === 0 ? (
            <Empty
              icon="inbox"
              title="No campaigns yet"
              description="Campaigns are written as content files and loaded here. Paste the JSON on the new campaign page, choose who it goes to, then schedule it."
              action={
                canCreate ? (
                  <LinkButton href="/marketing/campaigns/new" variant="primary">
                    New campaign
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead align="right">Recipients</TableHead>
                    <TableHead align="right">Sent</TableHead>
                    <TableHead align="right">Delivered</TableHead>
                    <TableHead align="right">Opened</TableHead>
                    <TableHead align="right">Clicked</TableHead>
                    <TableHead align="right">Unsubscribed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const stats = statsById.get(campaign.id) ?? null
                    return (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <Link
                            href={`/marketing/campaigns/${campaign.id}`}
                            className="font-medium text-text underline-offset-2 hover:underline"
                          >
                            {campaign.name}
                          </Link>
                          <div className="text-xs text-text-muted">{campaign.subject}</div>
                        </TableCell>
                        <TableCell>
                          <CampaignStatusBadge status={campaign.status} />
                        </TableCell>
                        <TableCell>
                          {campaign.scheduledFor ? (
                            formatDateTimeInLondon(campaign.scheduledFor)
                          ) : (
                            <span className="text-text-muted">Not scheduled</span>
                          )}
                        </TableCell>
                        <TableCell align="right">{campaign.summary.recipients}</TableCell>
                        <TableCell align="right">{campaign.summary.sent}</TableCell>
                        <TableCell align="right">
                          {stats ? (
                            formatCountWithRate(stats.delivered, stats.rates.deliveredRate)
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {stats ? (
                            stats.opened > 0 ? (
                              formatCountWithRate(stats.opened, stats.rates.openRate)
                            ) : (
                              <span className="text-text-muted">Not tracked</span>
                            )
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {stats ? (
                            formatCountWithRate(stats.clicked, stats.rates.clickRate)
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {stats ? (
                            formatCountWithRate(stats.unsubscribed, stats.rates.unsubscribeRate)
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <p className="text-sm text-text-muted">
          Campaigns are authored as JSON content files and pasted in on the new campaign page.
          There is no editor here on purpose: the layout blocks are fixed so every email renders
          the same way in every inbox. Opens are approximate because mail apps can prefetch
          images. Clicks exclude suspected automated link scans.
        </p>
      </div>
    </PageLayout>
  )
}
