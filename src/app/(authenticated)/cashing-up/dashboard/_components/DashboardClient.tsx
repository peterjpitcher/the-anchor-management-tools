'use client'

import { Card, CardHeader, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Stat, Badge, ProgressBar } from '@/ds'

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
  weeklyProgress: WeeklyProgress | null
  error?: string
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function DashboardClient({ dashboardData, weeklyProgress, error }: Props) {
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
  const varianceIsPositive = kpis.totalVariance >= 0

  return (
    <div className="space-y-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <Stat label="Total Takings" value={`£${fmt(kpis.totalTakings)}`} hint={`Target: £${fmt(kpis.totalTarget)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Total Variance"
              value={`£${fmt(kpis.totalVariance)}`}
              className={varianceIsPositive ? 'text-success-fg' : 'text-danger-fg'}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Sessions Submitted" value={kpis.daysWithSubmittedSessions} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Avg Daily Takings" value={`£${fmt(kpis.averageDailyTakings)}`} />
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
              tables.variance.slice(0, 7).map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <a
                      href={`/cashing-up/daily?date=${row.sessionDate}&siteId=${row.siteId}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {row.sessionDate}
                    </a>
                  </TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{fmt(row.cashTotal)}</TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{fmt(row.cardTotal)}</TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{fmt(row.stripeTotal)}</TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{fmt(row.totalTakings)}</TableCell>
                  <TableCell align="right" className={`font-mono font-bold ${row.variance < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                    {'£'}{fmt(row.variance)}
                  </TableCell>
                  <TableCell className="text-text-muted italic">{row.notes || '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
