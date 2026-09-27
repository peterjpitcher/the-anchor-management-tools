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
  Button,
  Input,
  Select,
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
import type { MarketingCampaignStats, MarketingCampaignStatus } from '@/types/marketing'

import {
  CampaignStatusBadge,
  formatCountWithRate,
  formatDateTimeInLondon,
} from './_shared/marketing-ui'
import { marketingLayout } from './_shared/nav'
import { UrlTablePagination } from './_components/UrlTablePagination'
import { UnsubscribeEmailCard } from './UnsubscribeEmailCard'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const STATUSES: MarketingCampaignStatus[] = ['draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled']
const SORTS = ['scheduled_asc', 'scheduled_desc', 'newest', 'oldest', 'name_asc', 'name_desc'] as const
type SearchParams = Record<string, string | string[] | undefined>
const firstValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

export default async function MarketingCampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const canView = await checkUserPermission('marketing', 'view')
  if (!canView) redirect('/unauthorized')

  const params = await searchParams
  const search = firstValue(params.search).trim().slice(0, 200)
  const rawStatus = firstValue(params.status)
  const status = rawStatus === 'all' || STATUSES.includes(rawStatus as MarketingCampaignStatus) ? rawStatus : 'upcoming'
  const rawAudience = firstValue(params.audience)
  const audience = rawAudience === 'business' || rawAudience === 'customer' ? rawAudience : ''
  const sort = SORTS.find(value => value === firstValue(params.sort)) ?? 'scheduled_asc'
  const pageNumber = Number(firstValue(params.page))
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 1000000) : 1
  // The filters in force, kept on every page link so paging never drops a search.
  const filterQuery: Record<string, string> = { status, sort }
  if (search) filterQuery.search = search
  if (audience) filterQuery.audience = audience
  const pageHref = (nextPage: number) => `/marketing?${new URLSearchParams({ ...filterQuery, page: String(nextPage) })}`

  const [canCreate, canEdit, canManageSettings] = await Promise.all([
    checkUserPermission('marketing', 'create'),
    checkUserPermission('marketing', 'edit'),
    checkUserPermission('marketing', 'manage'),
  ])
  const layoutProps = marketingLayout('campaigns', { canManageSettings })

  const [campaignsResult, settingsResult] = await Promise.all([
    listMarketingCampaigns({
      page, pageSize: PAGE_SIZE, search, sort, audienceType: audience || undefined,
      statuses: status === 'upcoming' ? ['draft', 'scheduled'] : status === 'all' ? undefined : [status as MarketingCampaignStatus],
    }),
    getMarketingSettings(),
  ])

  if (campaignsResult.error || !campaignsResult.data) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load campaigns">
          {campaignsResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const campaigns = campaignsResult.data.campaigns
  const total = campaignsResult.data.total
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (page > pages) redirect(pageHref(pages))
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
      {...layoutProps}
      headerActions={
        canCreate ? (
          <LinkButton href="/marketing/campaigns/new" variant="primary" size="sm">
            New Campaign
          </LinkButton>
        ) : undefined
      }
    >
      {/* No "Go to Settings" button: Settings is a tab in the row above. The tab only shows to
          someone with marketing:manage, so only they are pointed at it. */}
      {sendingOff && (
        <Alert tone="warning" title="Sending is switched off">
          Nothing will go out, even if a campaign is scheduled.{' '}
          {canManageSettings
            ? 'Turn sending back on in the Settings tab when you are ready.'
            : 'Someone who manages marketing settings can turn it back on.'}
        </Alert>
      )}

      {settingsResult.error && (
        <Alert tone="warning" title="Could not check whether sending is switched on">
          {settingsResult.error}. Treat the send switch as unknown until this loads.
        </Alert>
      )}

      {canEdit && <UnsubscribeEmailCard />}

      {/* Filters sit directly above the list they filter. A plain GET form, so the filters
          live in the URL and the server renders the result. */}
      <form key={`${search}:${status}:${audience}:${sort}`} action="/marketing" method="get" className="flex flex-wrap items-end gap-3" aria-label="Campaign filters">
        <div className="w-full sm:w-64">
          <Input label="Search campaigns" name="search" type="search" placeholder="Campaign name or subject" defaultValue={search} maxLength={200} />
        </div>
        <div className="w-full sm:w-48">
          <Select label="Status" name="status" defaultValue={status}>
            <option value="upcoming">Scheduled and drafts</option>
            <option value="all">All statuses</option>
            {STATUSES.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select label="Audience" name="audience" defaultValue={audience}>
            <option value="">All audiences</option>
            <option value="customer">Guests</option>
            <option value="business">Business contacts</option>
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select label="Sort by" name="sort" defaultValue={sort}>
            <option value="scheduled_asc">Send date: earliest first</option>
            <option value="scheduled_desc">Send date: latest first</option>
            <option value="newest">Created: newest first</option>
            <option value="oldest">Created: oldest first</option>
            <option value="name_asc">Campaign name: A to Z</option>
            <option value="name_desc">Campaign name: Z to A</option>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <LinkButton href="/marketing" variant="secondary">Reset</LinkButton>
          <Button type="submit" variant="primary">Apply</Button>
        </div>
      </form>

      <Card padding="none">
        <p className="border-b border-border px-4 py-3 text-sm text-text-muted" aria-live="polite">
          {total === 0 ? 'No matching campaigns' : `${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, total)} of ${total} campaigns`}
          {status === 'upcoming' && '. Showing scheduled and draft emails only.'}
        </p>
        {campaigns.length === 0 ? (
          <Empty
            size="sm"
            icon="inbox"
            title="No campaigns match these filters"
            description="Try another search or choose All statuses to include completed campaigns."
            action={
                <LinkButton href="/marketing?status=all" variant="secondary" size="sm">
                  Show All Campaigns
                </LinkButton>
            }
          />
        ) : (
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
        )}
        {pages > 1 && (
          <UrlTablePagination
            page={page}
            totalPages={pages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            path="/marketing"
            query={filterQuery}
          />
        )}
      </Card>

      <p className="text-sm text-text-muted">
        Campaigns are authored as JSON content files and pasted in on the new campaign page.
        There is no editor here on purpose: the layout blocks are fixed so every email renders
        the same way in every inbox. Opens are approximate because mail apps can prefetch
        images. Clicks exclude suspected automated link scans.
      </p>
    </PageLayout>
  )
}
