'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { Card, CardHeader, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Stat, Badge, ProgressBar, Select } from '@/ds'

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

function pctChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return Math.round(((current - previous) / previous) * 100)
}

function performanceTone(percent: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (percent === null) return 'neutral'
  if (percent >= 100) return 'success'
  if (percent >= 90) return 'warning'
  return 'danger'
}

function performanceRowClass(percent: number | null): string | undefined {
  if (percent === null) return undefined
  if (percent >= 100) return 'bg-success-soft hover:bg-success-soft'
  if (percent >= 90) return 'bg-warning-soft hover:bg-warning-soft'
  return 'bg-danger-soft hover:bg-danger-soft'
}

function formatPerformancePercent(percent: number | null): string {
  if (percent === null) return 'No target'
  return `${percent.toFixed(1)}%`
}

export function DashboardClient({ dashboardData, comparisonData, weeklyProgress, selectedYear, compareYear, error }: Props) {
  const router = useRouter()

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

  if (error || !dashboardData) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-center py-8">{error || 'No dashboard data available.'}</p>
        </CardBody>
      </Card>
    )
  }

  const { kpis, tables } = dashboardData
  const comp = comparisonData?.kpis
  const varianceIsPositive = kpis.totalVariance >= 0

  return (
    <div className="space-y-6">
      {/* Year selectors */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-muted">Year:</span>
          <Select
            value={String(selectedYear)}
            onChange={(e) => handleYearChange(e.target.value)}
            options={YEAR_OPTIONS}
            className="w-28"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-muted">Compare to:</span>
          <Select
            value={compareYear ? String(compareYear) : ''}
            onChange={(e) => handleCompareChange(e.target.value)}
            options={compareOptions}
            className="w-28"
          />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <Stat
              label="Total Takings"
              value={`£${fmt(kpis.totalTakings)}`}
              delta={comp ? pctChange(kpis.totalTakings, comp.totalTakings) : undefined}
              hint={comp ? `vs £${fmt(comp.totalTakings)} (${compareYear})` : `Target: £${fmt(kpis.totalTarget)}`}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Total Variance"
              value={`£${fmt(kpis.totalVariance)}`}
              delta={comp ? pctChange(kpis.totalVariance, comp.totalVariance) : undefined}
              hint={comp ? `vs £${fmt(comp.totalVariance)} (${compareYear})` : undefined}
              className={varianceIsPositive ? 'text-success-fg' : 'text-danger-fg'}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Sessions Submitted"
              value={kpis.daysWithSubmittedSessions}
              delta={comp ? pctChange(kpis.daysWithSubmittedSessions, comp.daysWithSubmittedSessions) : undefined}
              hint={comp ? `vs ${comp.daysWithSubmittedSessions} (${compareYear})` : undefined}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Avg Daily Takings"
              value={`£${fmt(kpis.averageDailyTakings)}`}
              delta={comp ? pctChange(kpis.averageDailyTakings, comp.averageDailyTakings) : undefined}
              hint={comp ? `vs £${fmt(comp.averageDailyTakings)} (${compareYear})` : undefined}
            />
          </CardBody>
        </Card>
      </div>

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
                tone={pct >= 100 ? 'success' : 'primary'}
                size="md"
              />
              <p className="text-xs text-text-muted mt-2">{pct.toFixed(1)}% of weekly target</p>
            </CardBody>
          </Card>
        )
      })()}

      {/* Recent sessions table */}
      <Card>
        <CardHeader title="Recent Variance & Discrepancies" />
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
            {tables.variance.length === 0 ? (
              <TableRow>
                <TableCell className="text-center py-8 text-text-muted" align="center">
                  No records found
                </TableCell>
              </TableRow>
            ) : (
              tables.variance.slice(0, 7).map((row, idx) => {
                const targetTone = performanceTone(row.targetPerformancePercent)
                return (
                  <TableRow key={idx} className={performanceRowClass(row.targetPerformancePercent)}>
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
                          <span className="text-[11px] text-text-muted font-mono">
                            £{fmt(row.accruedTakings)} / £{fmt(row.accruedTarget)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="right" className={`font-mono font-bold ${row.variance < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
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
    </div>
  )
}
