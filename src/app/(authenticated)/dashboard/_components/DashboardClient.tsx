'use client'

import Link from 'next/link'
import {
  Alert,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  LinkButton,
  PageLayout,
  ProgressBar,
  RevenueChart,
  Stat,
  StatGrid,
} from '@/ds'
import { ACTION_ITEM_SEVERITY_CLASSES } from '../_shared/status-ui'

/* ---------- Types ---------- */

interface UpcomingEvent {
  id: string
  dateLabel: string
  dayNumber: string
  title: string
  time: string
  host: string
  booked: number
  capacity: number
  badge: { tone: 'success' | 'warning' | 'primary' | 'neutral'; text: string }
  href: string
}

interface ActivityItem {
  id: string
  actor: string
  action: string
  time: string
}

interface MetricMini {
  label: string
  value: string
}

interface TodayItem {
  id: string
  type: 'event' | 'booking' | 'parking' | 'invoice' | 'note'
  title: string
  subtitle: string
  severity?: 'high' | 'medium' | 'low'
  href?: string | null
}

interface RevenueData {
  day: string
  amount: number
  target: number
}

interface ActionItem {
  id: string
  title: string
  description: string
  href: string
  severity: 'high' | 'medium' | 'low'
}

interface QuickAction {
  label: string
  href: string
  permitted: boolean
}

interface DashboardProps {
  subtitle: string
  /** The audit log needs settings:manage, so its link only shows to people who can open it. */
  canViewAuditLog: boolean
  calendar?: React.ReactNode
  revenueData: RevenueData[]
  revenueSummary: { avgDaily: string; completedThrough: string; vsLastWeek: string; lastYearSameWeek: string }
  todayTitle: string
  todayItems: TodayItem[]
  todayMeta: { openTime: string; onRota: string[]; bookings: string; covers: string }
  upcomingEvents: UpcomingEvent[]
  activity: ActivityItem[]
  miniMetrics: MetricMini[]
  actionItems: ActionItem[]
  quickActions: QuickAction[]
  alerts: { title: string; body: string; tone: 'warning' | 'info' }[]
  refreshAction: () => Promise<void>
}

/* ---------- Component ---------- */

export default function DashboardClient({
  subtitle,
  canViewAuditLog,
  calendar,
  revenueData,
  revenueSummary,
  todayTitle,
  todayItems,
  todayMeta,
  upcomingEvents,
  activity,
  miniMetrics,
  actionItems,
  quickActions,
  alerts,
  refreshAction,
}: DashboardProps): React.JSX.Element {
  const permittedQuickActions = quickActions.filter((q) => q.permitted)

  return (
    <PageLayout
      title="Dashboard"
      subtitle={subtitle}
      headerActions={
        <form action={refreshAction}>
          <Button type="submit" variant="secondary" size="sm">
            Refresh
          </Button>
        </form>
      }
    >
      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {alerts.map((a, i) => (
            <Alert key={i} tone={a.tone} title={a.title}>
              {a.body}
            </Alert>
          ))}
        </div>
      )}

      {/* Calendar */}
      {calendar}

      {/* Action Items + Quick Actions row */}
      {(actionItems.length > 0 || permittedQuickActions.length > 0) && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {actionItems.length > 0 && (
            <Card className="xl:col-span-2">
              <CardHeader title="Action Required" />
              <CardBody className="flex flex-col gap-2">
                {actionItems.map((item) => {
                  const severity = ACTION_ITEM_SEVERITY_CLASSES[item.severity]
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`flex items-start gap-3 p-3 rounded-default border transition-colors focus-visible:outline-hidden focus-visible:shadow-ring ${severity.row}`}
                    >
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${severity.text}`}>{item.title}</p>
                        <p className={`text-xs ${severity.text}`}>{item.description}</p>
                      </div>
                    </Link>
                  )
                })}
              </CardBody>
            </Card>
          )}

          {permittedQuickActions.length > 0 && (
            <Card>
              <CardHeader title="Quick Actions" />
              <CardBody>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {permittedQuickActions.map((action) => (
                    <LinkButton
                      key={action.label}
                      href={action.href}
                      variant="secondary"
                      className="w-full justify-center"
                    >
                      {action.label}
                    </LinkButton>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Today + Upcoming Events + Activity */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <Card>
          <CardHeader title={todayTitle} />
          <CardBody className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-ui">
              <span className="text-text-muted">On rota</span>
              {todayMeta.onRota.length > 0 ? (
                <AvatarStack names={todayMeta.onRota} max={4} size="sm" />
              ) : (
                <span className="text-text-soft">--</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 text-ui">
              <span className="text-text-muted">Table bookings</span>
              <span className="font-semibold text-text-strong tabular-nums">{todayMeta.bookings}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ui">
              <span className="text-text-muted">Covers</span>
              <span className="font-semibold text-text-strong tabular-nums">{todayMeta.covers}</span>
            </div>

            {todayItems.length > 0 && (
              <>
                <div className="h-px bg-border my-1" />
                <div className="flex flex-col gap-2">
                  {todayItems.slice(0, 6).map((item) => {
                    const content = (
                      <>
                        <span className="min-w-0 flex-1 truncate text-text-muted">{item.title}</span>
                        <span className="max-w-[55%] truncate text-xs text-text-soft">{item.subtitle}</span>
                      </>
                    )

                    return item.href ? (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="flex min-w-0 items-start gap-2 rounded-sm text-ui hover:text-primary focus-visible:outline-hidden focus-visible:shadow-ring"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div key={item.id} className="flex min-w-0 items-start gap-2 text-ui">
                        {content}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="h-px bg-border my-1" />
            <Link href="/events" className="rounded-sm text-ui text-primary font-medium hover:underline focus-visible:outline-hidden focus-visible:shadow-ring">
              View daily brief &rarr;
            </Link>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Upcoming Events"
            subtitle={`Next 7 days · ${upcomingEvents.length} events`}
            action={
              <LinkButton href="/events" variant="ghost" size="sm">
                All Events &rarr;
              </LinkButton>
            }
          />
          <CardBody className="p-0">
            {upcomingEvents.length === 0 ? (
              <Empty size="sm" title="No upcoming events" />
            ) : (
              <div className="px-pad-card">
                {upcomingEvents.map((e) => (
                  <Link
                    key={e.id}
                    href={e.href}
                    className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_auto] items-center gap-3.5 py-2.5 border-t border-border first:border-t-0 focus-visible:outline-hidden focus-visible:shadow-ring-inset"
                  >
                    <div className="w-11 text-center rounded-default bg-primary-soft text-primary-soft-fg py-1.5 flex-shrink-0">
                      <div className="text-2xs font-bold tracking-wider uppercase">{e.dateLabel}</div>
                      <div className="text-base font-bold leading-tight">{e.dayNumber}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-ui font-semibold text-text-strong truncate">{e.title}</div>
                      <div className="text-xs text-text-muted mt-0.5 truncate">{e.time} &middot; {e.host}</div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 min-w-[140px] justify-end">
                      <span className="text-xs text-text-muted tabular-nums">{e.booked}/{e.capacity}</span>
                      <div className="w-20">
                        <ProgressBar value={Math.round((e.booked / e.capacity) * 100)} size="sm" />
                      </div>
                    </div>
                    <Badge tone={e.badge.tone}>{e.badge.text}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader title="Activity" subtitle="Last 24h" />
          <CardBody className="flex flex-col gap-3">
            {activity.length === 0 ? (
              <Empty size="sm" title="No recent activity" />
            ) : (
              activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <Avatar name={a.actor} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-ui">
                      <span className="font-semibold text-text-strong">{a.actor}</span>{' '}
                      <span className="text-text-muted">{a.action}</span>
                    </div>
                    <div className="text-meta text-text-muted mt-0.5">{a.time}</div>
                  </div>
                </div>
              ))
            )}
            {canViewAuditLog && (
              <>
                <div className="h-px bg-border" />
                <Link href="/settings/audit-logs" className="rounded-sm text-ui text-primary font-medium hover:underline focus-visible:outline-hidden focus-visible:shadow-ring">
                  View audit log &rarr;
                </Link>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Revenue */}
      <Card>
        <CardHeader
          title="Revenue"
          subtitle="Cashing up totals"
        />
        <CardBody className="space-y-4">
          {revenueData.length > 0 ? (
            <RevenueChart data={revenueData} />
          ) : (
            <Empty size="sm" icon="chart" title="No cashing up data for this period" />
          )}
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 md:grid-cols-4">
            <Stat label="Average daily" value={revenueSummary.avgDaily} />
            <Stat label="Completed through" value={revenueSummary.completedThrough} />
            <Stat label="Week vs last" value={revenueSummary.vsLastWeek} />
            <Stat label="Last year same week" value={revenueSummary.lastYearSameWeek} />
          </div>
        </CardBody>
      </Card>

      {/* Mini metrics */}
      <StatGrid columns={4}>
        {miniMetrics.map((m) => (
          <Stat key={m.label} label={m.label} value={m.value} />
        ))}
      </StatGrid>
    </PageLayout>
  )
}
