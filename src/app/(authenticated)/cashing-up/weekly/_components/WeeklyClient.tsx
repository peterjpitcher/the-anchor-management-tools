'use client'

import { useState, useCallback } from 'react'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Button, Badge, Stat, LinkButton } from '@/ds'
import { Icon } from '@/ds/icons'
import { getWeeklyDataAction } from '@/app/actions/cashing-up'

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
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const amount = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const roundCurrency = (value: number): number => Number(value.toFixed(2))

const statusTone = (status: string) => {
  switch (status) {
    case 'approved': return 'success' as const
    case 'submitted': return 'info' as const
    case 'locked': return 'warning' as const
    default: return 'neutral' as const
  }
}

export function WeeklyClient({ siteId, weekStart: initialWeekStart, initialData }: Props) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [data, setData] = useState<WeeklyRow[]>(initialData as WeeklyRow[])
  const [loading, setLoading] = useState(false)

  const shiftWeek = useCallback(async (direction: -1 | 1) => {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + direction * 7)
    const newWeek = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setWeekStart(newWeek)
    setLoading(true)
    try {
      const res = await getWeeklyDataAction(siteId, newWeek)
      setData((res.data ?? []) as WeeklyRow[])
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
    <div className="space-y-6">
      {/* Week picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => shiftWeek(-1)} disabled={loading}>
            <Icon name="chevronLeft" size={16} />
          </Button>
          <span className="text-sm font-medium text-text">
            {weekStart} to {sundayStr}
          </span>
          <Button variant="secondary" size="sm" onClick={() => shiftWeek(1)} disabled={loading}>
            <Icon name="chevronRight" size={16} />
          </Button>
        </div>
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
      </div>

      {/* Weekly table */}
      <Card>
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
                <TableCell className="text-center text-text-muted py-8" align="center">
                  No data for this week
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
                        className={`font-mono font-bold ${cashVariance < 0 ? 'text-danger-fg' : cashVariance > 0 ? 'text-success-fg' : ''}`}
                      >
                        {'£'}{fmt(cashVariance)}
                      </TableCell>
                      <TableCell
                        align="right"
                        className={`font-mono font-bold ${targetVariance < 0 ? 'text-danger-fg' : targetVariance > 0 ? 'text-success-fg' : ''}`}
                      >
                        {'£'}{fmt(targetVariance)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusTone(row.status)} dot>{row.status}</Badge>
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
                    className={`font-mono font-bold ${totals.cashVariance < 0 ? 'text-danger-fg' : totals.cashVariance > 0 ? 'text-success-fg' : ''}`}
                  >
                    {'£'}{fmt(totals.cashVariance)}
                  </TableCell>
                  <TableCell
                    align="right"
                    className={`font-mono font-bold ${totals.targetVariance < 0 ? 'text-danger-fg' : totals.targetVariance > 0 ? 'text-success-fg' : ''}`}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <Card>
          <CardBody>
            <Stat label="Weekly target" value={`£${fmt(totals.target)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Weekly expected" value={`£${fmt(totals.expected)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Weekly counted" value={`£${fmt(totals.counted)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Cash variance"
              value={`£${fmt(totals.cashVariance)}`}
              className={totals.cashVariance >= 0 ? 'text-success-fg' : 'text-danger-fg'}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Vs target"
              value={`£${fmt(totals.targetVariance)}`}
              className={totals.targetVariance >= 0 ? 'text-success-fg' : 'text-danger-fg'}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
