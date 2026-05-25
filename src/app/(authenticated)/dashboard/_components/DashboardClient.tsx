'use client'

import Link from 'next/link'
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Button,
  Avatar,
  AvatarStack,
  Alert,
  Empty,
  ProgressBar,
  Sparkline,
  RevenueChart,
} from '@/ds'

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
  trend: number[]
  tone?: 'primary' | 'warning'
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
}: DashboardProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard' }]}
        title="Dashboard"
        subtitle={subtitle}
        className="mb-0"
        actions={
          <form action={refreshAction}>
            <Button type="submit" variant="secondary" size="sm">
              Refresh
            </Button>
          </form>
        }
      />

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      {(actionItems.length > 0 || quickActions.filter((q) => q.permitted).length > 0) && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {actionItems.length > 0 && (
            <Card className="xl:col-span-2">
              <CardHeader title="Action Required" />
              <CardBody className="flex flex-col gap-2">
                {actionItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      item.severity === 'high'
                        ? 'bg-danger-soft border-danger/20 hover:bg-danger-soft'
                        : 'bg-warning-soft border-warning/20 hover:bg-warning-soft'
                    }`}
                  >
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${item.severity === 'high' ? 'text-danger-fg' : 'text-warning-fg'}`}>
                        {item.title}
                      </p>
                      <p className={`text-xs ${item.severity === 'high' ? 'text-danger-fg' : 'text-warning-fg'} opacity-80`}>
                        {item.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}

          {quickActions.filter((q) => q.permitted).length > 0 && (
            <Card>
              <CardHeader title="Quick Actions" />
              <CardBody>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {quickActions
                    .filter((qa) => qa.permitted)
                    .map((action) => (
                      <Link
                        key={action.label}
                        href={action.href}
                        className="flex items-center justify-center p-3 bg-surface border border-border rounded-lg hover:border-primary hover:bg-primary-soft transition-all text-center text-xs font-medium text-text-muted hover:text-primary-soft-fg"
                      >
                        {action.label}
                      </Link>
                    ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Today + Upcoming Events + Activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <Card>
          <CardHeader title={todayTitle} />
          <CardBody className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-text-muted">On rota</span>
              {todayMeta.onRota.length > 0 ? (
                <AvatarStack names={todayMeta.onRota} max={4} size="sm" />
              ) : (
                <span className="text-text-subtle">--</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-text-muted">Table bookings</span>
              <span className="font-semibold text-text-strong tabular-nums">{todayMeta.bookings}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-text-muted">Covers</span>
              <span className="font-semibold text-text-strong tabular-nums">{todayMeta.covers}</span>
            </div>

            {todayItems.length > 0 && (
              <>
                <div className="h-px bg-border my-1" />
                <div className="flex flex-col gap-2">
                  {todayItems.slice(0, 6).map((item) => (
                    <div key={item.id} className="flex min-w-0 items-start gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-text-muted">{item.title}</span>
                      <span className="max-w-[55%] truncate text-xs text-text-subtle">{item.subtitle}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="h-px bg-border my-1" />
            <Link href="/events" className="text-[13px] text-primary font-medium hover:underline">
              View daily brief &rarr;
            </Link>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Upcoming events"
            subtitle={`Next 7 days · ${upcomingEvents.length} events`}
            action={
              <Link href="/events">
                <Button variant="ghost" size="sm">
                  All events &rarr;
                </Button>
              </Link>
            }
          />
          <CardBody className="p-0">
            {upcomingEvents.length === 0 ? (
              <Empty title="No upcoming events" className="py-8" />
            ) : (
              <div className="px-[var(--spacing-pad-card)]">
                {upcomingEvents.map((e) => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3.5 py-2.5 border-t border-border first:border-t-0"
                  >
                    <div className="w-11 text-center rounded-lg bg-primary-soft text-primary-soft-fg py-1.5 flex-shrink-0">
                      <div className="text-[10px] font-bold tracking-wider uppercase">{e.dateLabel}</div>
                      <div className="text-base font-bold leading-tight">{e.dayNumber}</div>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-text-strong">{e.title}</div>
                      <div className="text-xs text-text-muted mt-0.5">{e.time} &middot; {e.host}</div>
                    </div>
                    <div className="flex items-center gap-2 min-w-[140px] justify-end">
                      <span className="text-xs text-text-muted tabular-nums">{e.booked}/{e.capacity}</span>
                      <div className="w-20">
                        <ProgressBar value={Math.round((e.booked / e.capacity) * 100)} size="sm" />
                      </div>
                    </div>
                    <Badge tone={e.badge.tone}>{e.badge.text}</Badge>
                  </div>
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
              <Empty title="No recent activity" />
            ) : (
              activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <Avatar name={a.actor} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px]">
                      <span className="font-semibold text-text-strong">{a.actor}</span>{' '}
                      <span className="text-text-muted">{a.action}</span>
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">{a.time}</div>
                  </div>
                </div>
              ))
            )}
            <div className="h-px bg-border" />
            <Link href="/settings/audit-logs" className="text-[13px] text-primary font-medium hover:underline">
              View audit log &rarr;
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Revenue */}
      <Card>
        <CardHeader
          title="Revenue"
          subtitle="Cashing up totals"
        />
        <CardBody>
          {revenueData.length > 0 ? (
            <RevenueChart data={revenueData} />
          ) : (
            <div className="h-[160px] flex items-center justify-center text-sm text-text-muted">
              No cashing up data for this period
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border md:grid-cols-4">
            <div>
              <div className="text-[11px] text-text-muted">Average daily</div>
              <div className="text-base font-semibold text-text-strong tabular-nums">{revenueSummary.avgDaily}</div>
            </div>
            <div>
              <div className="text-[11px] text-text-muted">Completed through</div>
              <div className="text-base font-semibold text-text-strong tabular-nums">{revenueSummary.completedThrough}</div>
            </div>
            <div>
              <div className="text-[11px] text-text-muted">Week vs last</div>
              <div className={`text-base font-semibold tabular-nums ${revenueSummary.vsLastWeek.startsWith('-') ? 'text-error' : revenueSummary.vsLastWeek === '--' ? 'text-text-muted' : 'text-success'}`}>{revenueSummary.vsLastWeek}</div>
            </div>
            <div>
              <div className="text-[11px] text-text-muted">Last year same week</div>
              <div className={`text-base font-semibold tabular-nums ${revenueSummary.lastYearSameWeek.startsWith('-') ? 'text-error' : revenueSummary.lastYearSameWeek === '--' ? 'text-text-muted' : 'text-success'}`}>{revenueSummary.lastYearSameWeek}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Mini Metric Sparklines */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {miniMetrics.map((m) => (
          <Card key={m.label}>
            <CardBody>
              <div className="text-xs text-text-muted font-medium mb-2">{m.label}</div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-bold text-text-strong tabular-nums">{m.value}</div>
                <Sparkline
                  data={m.trend}
                  color={m.tone === 'warning' ? 'var(--color-warning)' : undefined}
                />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
