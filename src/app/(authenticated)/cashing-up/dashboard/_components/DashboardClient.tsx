'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Card, CardHeader, CardBody, PageLayout, StatGrid, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Alert, Stat, Badge, Empty, ProgressBar, Select, Input } from '@/ds'
import { cashingUpLayout } from '../../_shared/nav'
import { cashVarianceTextClass, targetPerformanceRowClass, targetPerformanceTone, weeklyProgressTone } from '../../_shared/status-ui'

interface DashboardData {
  kpis: {
    totalTakings: number
    totalTarget: number
    totalVariance: number
    averageDailyTakings: number
    daysWithSubmittedSessions: number
  }
  tables: {
    variance: Array<{
      sessionDate: string
      siteId: string
      cashTotal: number
      cardTotal: number
      stripeTotal: number
      totalTakings: number
      variance: number
      dailyTarget: number
      accruedTarget: number
      accruedTakings: number
      targetPerformancePercent: number | null
      notes: string | null
    }>
  }
}

interface WeeklyProgress {
  weekStart: string
  dailyProgress: Array<{
    date: string
    target: number
    actual: number | null
  }>
}

interface Props {
  dashboardData: DashboardData | null
  comparisonData: DashboardData | null
  weeklyProgress: WeeklyProgress | null
  selectedYear: number
  compareYear?: number
  error?: string
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatSessionDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return format(parsed, 'EEEE, MMMM do yyyy')
}

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: currentYear - 2018 }, (_, i) => ({
  label: String(currentYear - i),
  value: String(currentYear - i),
}))
const EMPTY_VARIANCE_ROWS: DashboardData['tables']['variance'] = []

function pctChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return Math.round(((current - previous) / previous) * 100)
}

function formatPerformancePercent(percent: number | null): string {
  if (percent === null) return 'No target'
  return `${percent.toFixed(1)}%`
}

export function DashboardClient({ dashboardData, comparisonData, weeklyProgress, selectedYear, compareYear, error }: Props) {
  const router = useRouter()
  const [sessionSearch, setSessionSearch] = useState('')

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams()
    params.set('year', year)
    if (compareYear) params.set('compareYear', String(compareYear))
    router.push(`/cashing-up/dashboard?${params.toString()}`)
  }

  const handleCompareChange = (year: string) => {
    const params = new URLSearchParams()
    params.set('year', String(selectedYear))
    if (year) params.set('compareYear', year)
    router.push(`/cashing-up/dashboard?${params.toString()}`)
  }

  const compareOptions = [
    { label: 'None', value: '' },
    ...YEAR_OPTIONS.filter((o) => o.value !== String(selectedYear)),
  ]
  const varianceRows = dashboardData?.tables.variance ?? EMPTY_VARIANCE_ROWS
  const visibleVarianceRows = useMemo(() => {
    const term = sessionSearch.trim().toLowerCase()
    if (!term) return varianceRows
    return varianceRows.filter((row) =>
      [
        formatSessionDate(row.sessionDate),
        row.sessionDate,
        row.notes ?? '',
        String(row.cashTotal),
        String(row.cardTotal),
        String(row.stripeTotal),
        String(row.totalTakings),
        String(row.variance),
      ].some((value) => value.toLowerCase().includes(term))
    )
  }, [sessionSearch, varianceRows])

  const layoutProps = cashingUpLayout('Takings, targets and variance by year')

  if (error) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger">{error}</Alert>
      </PageLayout>
    )
  }

  if (!dashboardData) {
    return (
      <PageLayout {...layoutProps}>
        <Card>
          <Empty size="sm" title="No dashboard data available" />
        </Card>
      </PageLayout>
    )
  }

  const { kpis } = dashboardData
  const comp = comparisonData?.kpis

  return (
    <PageLayout {...layoutProps}>
      {/* Year selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Year"
          value={String(selectedYear)}
          onChange={(e) => handleYearChange(e.target.value)}
          options={YEAR_OPTIONS}
          className="w-28"
        />
        <Select
          label="Compare to"
          value={compareYear ? String(compareYear) : ''}
          onChange={(e) => handleCompareChange(e.target.value)}
          options={compareOptions}
          className="w-28"
        />
      </div>

      {/* Stat tiles */}
      <StatGrid columns={4}>
        <Stat
          label="Total Takings"
          value={`£${fmt(kpis.totalTakings)}`}
          delta={comp ? pctChange(kpis.totalTakings, comp.totalTakings) : undefined}
          hint={comp ? `vs £${fmt(comp.totalTakings)} (${compareYear})` : `Target: £${fmt(kpis.totalTarget)}`}
        />
        <Stat
          label="Total Variance"
          value={`£${fmt(kpis.totalVariance)}`}
          delta={comp ? pctChange(kpis.totalVariance, comp.totalVariance) : undefined}
          hint={comp ? `vs £${fmt(comp.totalVariance)} (${compareYear})` : undefined}
        />
        <Stat
          label="Sessions Submitted"
          value={kpis.daysWithSubmittedSessions}
          delta={comp ? pctChange(kpis.daysWithSubmittedSessions, comp.daysWithSubmittedSessions) : undefined}
          hint={comp ? `vs ${comp.daysWithSubmittedSessions} (${compareYear})` : undefined}
        />
        <Stat
          label="Avg Daily Takings"
          value={`£${fmt(kpis.averageDailyTakings)}`}
          delta={comp ? pctChange(kpis.averageDailyTakings, comp.averageDailyTakings) : undefined}
          hint={comp ? `vs £${fmt(comp.averageDailyTakings)} (${compareYear})` : undefined}
        />
      </StatGrid>

      {/* Weekly progress */}
      {weeklyProgress && weeklyProgress.dailyProgress.length > 0 && (() => {
        const totalTarget = weeklyProgress.dailyProgress.reduce((s, d) => s + d.target, 0)
        const totalActual = weeklyProgress.dailyProgress.reduce((s, d) => s + (d.actual ?? 0), 0)
        const pct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0
        return (
          <Card>
            <CardHeader title="Weekly Progress" subtitle={`£${fmt(totalActual)} of £${fmt(totalTarget)} target`} />
            <CardBody>
              <ProgressBar
                value={Math.min(pct, 100)}
                tone={weeklyProgressTone(pct)}
                size="md"
                label="Weekly target progress"
              />
              <p className="text-xs text-text-muted mt-2">{pct.toFixed(1)}% of weekly target</p>
            </CardBody>
          </Card>
        )
      })()}

      {/* Recent sessions table */}
      <Card>
        <CardHeader title="Variance & Discrepancies" />
        <CardBody>
          <Input
            value={sessionSearch}
            onChange={(event) => setSessionSearch(event.target.value)}
            placeholder="Search sessions..."
            aria-label="Search cash-up sessions"
            className="sm:max-w-xs"
          />
        </CardBody>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead align="right">Cash</TableHead>
              <TableHead align="right">Card</TableHead>
              <TableHead align="right">Stripe</TableHead>
              <TableHead align="right">Total</TableHead>
              <TableHead align="right">WTD Target</TableHead>
              <TableHead align="right">Variance</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleVarianceRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Empty size="sm" title={sessionSearch ? 'No sessions match your search' : 'No records found'} />
                </TableCell>
              </TableRow>
            ) : (
              visibleVarianceRows.map((row, idx) => {
                const targetTone = targetPerformanceTone(row.targetPerformancePercent)
                return (
                  <TableRow key={idx} className={targetPerformanceRowClass(row.targetPerformancePercent)}>
                    <TableCell>
                      <a
                        href={`/cashing-up/daily?date=${row.sessionDate}&siteId=${row.siteId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {formatSessionDate(row.sessionDate)}
                      </a>
                    </TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.cashTotal)}</TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.cardTotal)}</TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.stripeTotal)}</TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.totalTakings)}</TableCell>
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-1">
                        <Badge tone={targetTone} className="font-mono">
                          {formatPerformancePercent(row.targetPerformancePercent)}
                        </Badge>
                        {row.accruedTarget > 0 && (
                          <span className="text-meta text-text-muted font-mono">
                            £{fmt(row.accruedTakings)} / £{fmt(row.accruedTarget)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="right" className={`font-mono font-bold ${cashVarianceTextClass(row.variance ?? 0)}`}>
                      {'£'}{fmt(row.variance)}
                    </TableCell>
                    <TableCell className="text-text-muted italic">{row.notes || '-'}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </PageLayout>
  )
}
