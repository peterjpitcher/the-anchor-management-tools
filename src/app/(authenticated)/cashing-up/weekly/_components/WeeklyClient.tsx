'use client'

import { useState, useCallback } from 'react'
import {
  Card, CardHeader, PageLayout, StatGrid,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Alert, Badge, Empty, IconButton, PageLoading, Stat, LinkButton } from '@/ds'
import { Icon } from '@/ds/icons'
import { getWeeklyDataAction } from '@/app/actions/cashing-up'
import { cashingUpLayout } from '../../_shared/nav'
import { cashupSessionStatusTone, signedAmountTextClass } from '../../_shared/status-ui'

interface WeeklyRow {
  session_date: string
  status: string
  total_expected_amount: number | string | null
  total_counted_amount: number | string | null
  total_variance_amount?: number | string | null
  target_amount?: number | string | null
}

interface Props {
  siteId: string
  weekStart: string
  initialData: unknown[]
  /** Why the first week could not be loaded, if it could not. */
  initialError?: string
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const amount = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const roundCurrency = (value: number): number => Number(value.toFixed(2))

export function WeeklyClient({ siteId, weekStart: initialWeekStart, initialData, initialError }: Props) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [data, setData] = useState<WeeklyRow[]>(initialData as WeeklyRow[])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(initialError)

  const shiftWeek = useCallback(async (direction: -1 | 1) => {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + direction * 7)
    const newWeek = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setWeekStart(newWeek)
    setLoading(true)
    try {
      const res = await getWeeklyDataAction(siteId, newWeek)
      setData((res.data ?? []) as WeeklyRow[])
      setLoadError(res.data ? undefined : res.error)
    } catch {
      setData([])
      setLoadError('Could not load this week. Try again.')
    } finally {
      setLoading(false)
    }
  }, [siteId, weekStart])

  // Calculate Sunday from Monday
  const sundayDate = new Date(weekStart + 'T12:00:00')
  sundayDate.setDate(sundayDate.getDate() + 6)
  const sundayStr = `${sundayDate.getFullYear()}-${String(sundayDate.getMonth() + 1).padStart(2, '0')}-${String(sundayDate.getDate()).padStart(2, '0')}`
  const pdfHref = `/api/cashup/weekly/print?siteId=${encodeURIComponent(siteId)}&weekStartDate=${encodeURIComponent(weekStart)}`

  // Totals
  const baseTotals = data.reduce(
    (acc, row) => ({
      target: acc.target + amount(row.target_amount),
      expected: acc.expected + amount(row.total_expected_amount),
      counted: acc.counted + amount(row.total_counted_amount),
    }),
    { target: 0, expected: 0, counted: 0 }
  )
  const totals = {
    target: roundCurrency(baseTotals.target),
    expected: roundCurrency(baseTotals.expected),
    counted: roundCurrency(baseTotals.counted),
    cashVariance: roundCurrency(baseTotals.counted - baseTotals.expected),
    targetVariance: roundCurrency(baseTotals.counted - baseTotals.target),
  }

  return (
    <PageLayout
      {...cashingUpLayout('Takings for one week against target')}
      headerActions={
        <>
          <IconButton
            variant="secondary"
            size="sm"
            label="Previous week"
            icon={<Icon name="chevronLeft" size={16} />}
            onClick={() => shiftWeek(-1)}
            disabled={loading}
          />
          <span className="text-sm font-medium text-text">
            {weekStart} to {sundayStr}
          </span>
          <IconButton
            variant="secondary"
            size="sm"
            label="Next week"
            icon={<Icon name="chevronRight" size={16} />}
            onClick={() => shiftWeek(1)}
            disabled={loading}
          />
          {siteId && data.length > 0 && (
            <LinkButton
              href={pdfHref}
              target="_blank"
              variant="secondary"
              size="sm"
              icon={<Icon name="download" size={16} />}
            >
              Download PDF
            </LinkButton>
          )}
        </>
      }
    >
      {loading ? (
        <PageLoading inline label="Loading the week" />
      ) : loadError ? (
        <Alert tone="danger" title="Couldn't load this week">{loadError}</Alert>
      ) : (
        <>
          {/* Weekly table */}
          <Card padding="none">
            <CardHeader title="Weekly Breakdown" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead align="right">Target</TableHead>
                  <TableHead align="right">Expected</TableHead>
                  <TableHead align="right">Counted</TableHead>
                  <TableHead align="right">Cash variance</TableHead>
                  <TableHead align="right">Vs target</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Empty size="sm" title="No data for this week" />
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {data.map((row) => {
                      const targetAmount = amount(row.target_amount)
                      const expectedAmount = amount(row.total_expected_amount)
                      const countedAmount = amount(row.total_counted_amount)
                      const cashVariance = roundCurrency(countedAmount - expectedAmount)
                      const targetVariance = roundCurrency(countedAmount - targetAmount)

                      return (
                        <TableRow key={row.session_date}>
                          <TableCell className="font-medium">
                            <a href={`/cashing-up/daily?date=${row.session_date}&siteId=${siteId}`} className="text-primary hover:underline">
                              {row.session_date}
                            </a>
                          </TableCell>
                          <TableCell align="right" className="font-mono">{'£'}{fmt(targetAmount)}</TableCell>
                          <TableCell align="right" className="font-mono">{'£'}{fmt(expectedAmount)}</TableCell>
                          <TableCell align="right" className="font-mono">{'£'}{fmt(countedAmount)}</TableCell>
                          <TableCell
                            align="right"
                            className={`font-mono font-bold ${signedAmountTextClass(cashVariance)}`}
                          >
                            {'£'}{fmt(cashVariance)}
                          </TableCell>
                          <TableCell
                            align="right"
                            className={`font-mono font-bold ${signedAmountTextClass(targetVariance)}`}
                          >
                            {'£'}{fmt(targetVariance)}
                          </TableCell>
                          <TableCell>
                            <Badge tone={cashupSessionStatusTone(row.status)} dot>{row.status}</Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {/* Totals row */}
                    <TableRow className="bg-surface-2 font-semibold">
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell align="right" className="font-mono font-bold">{'£'}{fmt(totals.target)}</TableCell>
                      <TableCell align="right" className="font-mono font-bold">{'£'}{fmt(totals.expected)}</TableCell>
                      <TableCell align="right" className="font-mono font-bold">{'£'}{fmt(totals.counted)}</TableCell>
                      <TableCell
                        align="right"
                        className={`font-mono font-bold ${signedAmountTextClass(totals.cashVariance)}`}
                      >
                        {'£'}{fmt(totals.cashVariance)}
                      </TableCell>
                      <TableCell
                        align="right"
                        className={`font-mono font-bold ${signedAmountTextClass(totals.targetVariance)}`}
                      >
                        {'£'}{fmt(totals.targetVariance)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Category stats */}
          <StatGrid columns={3} className="xl:grid-cols-5">
            <Stat label="Weekly target" value={`£${fmt(totals.target)}`} />
            <Stat label="Weekly expected" value={`£${fmt(totals.expected)}`} />
            <Stat label="Weekly counted" value={`£${fmt(totals.counted)}`} />
            <Stat label="Cash variance" value={`£${fmt(totals.cashVariance)}`} />
            <Stat label="Vs target" value={`£${fmt(totals.targetVariance)}`} />
          </StatGrid>
        </>
      )}
    </PageLayout>
  )
}
