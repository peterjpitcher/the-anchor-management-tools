import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getLegacyDomainUsage } from '@/app/actions/short-links'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  SectionNav,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { SHORT_LINKS_NAV } from '../nav'
import type { LegacyDomainUsage } from '@/types/short-links'

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const RANGE_OPTIONS = [30, 90, 180, 365]

function parseDays(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return RANGE_OPTIONS.includes(parsed) ? parsed : 90
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB')
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(new Date(value))
}

function formatDestination(host: string | null, path: string | null): string {
  if (!host && !path) return '-'
  if (!host) return path || '-'
  return `${host}${path || ''}`
}

function sourceLabel(channel: string | null, source: string | null): string {
  return channel || source || '-'
}

function RangeSelector({ days }: { days: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {RANGE_OPTIONS.map((option) => {
        const active = option === days
        return (
          <Link
            key={option}
            href={`/short-links/legacy-domain?days=${option}`}
            className={
              active
                ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2'
            }
          >
            {option} days
          </Link>
        )
      })}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-danger-fg">{message}</p>
      </CardBody>
    </Card>
  )
}

function SummaryCards({ usage }: { usage: LegacyDomainUsage }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <CardBody>
          <Stat
            label="Legacy Human"
            value={formatNumber(usage.legacyHumanClicks)}
            hint={`${formatNumber(usage.legacyClicks)} total vip-club clicks`}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <Stat
            label="Canonical Human"
            value={formatNumber(usage.canonicalHumanClicks)}
            hint={`${formatNumber(usage.canonicalClicks)} total l.the-anchor clicks`}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <Stat
            label="Untracked Human"
            value={formatNumber(usage.untrackedHumanClicks)}
            hint={`${formatNumber(usage.untrackedClicks)} clicks before host tracking`}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <Stat
            label="All Human"
            value={formatNumber(usage.humanClicks)}
            hint={`${formatNumber(usage.totalClicks)} total short-link clicks`}
          />
        </CardBody>
      </Card>
    </div>
  )
}

function LinkUsageCard({
  title,
  subtitle,
  links,
  emptyMessage,
}: {
  title: string
  subtitle: string
  links: LegacyDomainUsage['topLegacyLinks']
  emptyMessage: string
}) {
  return (
    <Card className="mb-6">
      <CardHeader title={title} subtitle={subtitle} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Link</TableHead>
            <TableHead className="hidden md:table-cell">Name</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead align="right">Human</TableHead>
            <TableHead align="right" className="hidden md:table-cell">Total</TableHead>
            <TableHead className="hidden md:table-cell">Last Click</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} align="center" className="py-8 text-text-muted">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            links.map((link) => (
              <TableRow key={link.shortCode}>
                <TableCell>
                  <code className="font-mono text-xs">/{link.shortCode}</code>
                </TableCell>
                <TableCell className="hidden max-w-xs truncate md:table-cell">{link.name || '-'}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge tone="info">{sourceLabel(link.channel, link.source)}</Badge>
                </TableCell>
                <TableCell className="max-w-[180px] truncate sm:max-w-sm">
                  {formatDestination(link.destinationHost, link.destinationPath)}
                </TableCell>
                <TableCell align="right" className="font-mono font-semibold">
                  {formatNumber(link.humanClicks)}
                </TableCell>
                <TableCell align="right" className="hidden font-mono md:table-cell">
                  {formatNumber(link.totalClicks)}
                </TableCell>
                <TableCell className="hidden md:table-cell">{formatDateTime(link.lastClickedAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

export default async function LegacyDomainPage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('short_links', 'view')
  if (!canView) redirect('/unauthorized')

  const params = searchParams ? await searchParams : {}
  const days = parseDays(params.days)
  const result = await getLegacyDomainUsage(days)
  const usage = result && 'data' in result ? result.data : null

  return (
    <div>
      <PageHeader title="Short Links" subtitle="Legacy domain retirement tracking" />
      <SectionNav items={SHORT_LINKS_NAV} activeId="legacy-domain" className="mb-6" />
      <RangeSelector days={days} />

      {!usage ? (
        <ErrorState message={result && 'error' in result ? result.error || 'Failed to load legacy domain usage' : 'Failed to load legacy domain usage'} />
      ) : (
        <>
          {!usage.trackingColumnReady && (
            <Card className="mb-6 border-warning/25 bg-warning-soft">
              <CardBody>
                <p className="text-sm text-warning-fg">
                  Host tracking has not been migrated yet. These numbers show existing click activity, but legacy-domain clicks cannot be separated until the migration is applied.
                </p>
              </CardBody>
            </Card>
          )}

          <SummaryCards usage={usage} />

          <LinkUsageCard
            title="Top Legacy Domain Links"
            subtitle={`vip-club.uk clicks since ${formatDateTime(usage.startAt)}`}
            links={usage.topLegacyLinks}
            emptyMessage="No legacy-domain clicks in this range"
          />

          <Card>
            <CardHeader title="Recent Legacy Clicks" subtitle="Latest tracked vip-club.uk requests" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="hidden md:table-cell">Host</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead className="hidden md:table-cell">Name</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="hidden md:table-cell">Device</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.recentLegacyClicks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" className="py-8 text-text-muted">
                      No recent legacy-domain clicks
                    </TableCell>
                  </TableRow>
                ) : (
                  usage.recentLegacyClicks.map((click, index) => (
                    <TableRow key={`${click.shortCode}-${click.clickedAt}-${index}`}>
                      <TableCell>{formatDateTime(click.clickedAt)}</TableCell>
                      <TableCell className="hidden md:table-cell">{click.requestHost}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">/{click.shortCode}</code>
                      </TableCell>
                      <TableCell className="hidden max-w-xs truncate md:table-cell">{click.name || '-'}</TableCell>
                      <TableCell className="max-w-[180px] truncate sm:max-w-sm">
                        {formatDestination(click.destinationHost, click.destinationPath)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{click.deviceType || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
