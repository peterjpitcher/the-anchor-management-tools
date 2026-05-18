'use client'

import { useState, useCallback } from 'react'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Button, Badge, Stat, Input } from '@/ds'
import { Icon } from '@/ds/icons'
import { getWeeklyDataAction } from '@/app/actions/cashing-up'

interface WeeklyRow {
  session_date: string
  status: string
  total_expected_amount: number
  total_counted_amount: number
  total_variance_amount: number
  target_amount?: number
}

interface Props {
  siteId: string
  weekStart: string
  initialData: unknown[]
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

  // Totals
  const totals = data.reduce(
    (acc, row) => ({
      expected: acc.expected + (row.total_expected_amount || 0),
      counted: acc.counted + (row.total_counted_amount || 0),
      variance: acc.variance + (row.total_variance_amount || 0),
    }),
    { expected: 0, counted: 0, variance: 0 }
  )

  return (
    <div className="space-y-6">
      {/* Week picker */}
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

      {/* Weekly table */}
      <Card>
        <CardHeader title="Weekly Breakdown" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead align="right">Expected</TableHead>
              <TableHead align="right">Counted</TableHead>
              <TableHead align="right">Variance</TableHead>
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
                {data.map((row) => (
                  <TableRow key={row.session_date}>
                    <TableCell className="font-medium">
                      <a href={`/cashing-up/daily?date=${row.session_date}&siteId=${siteId}`} className="text-primary hover:underline">
                        {row.session_date}
                      </a>
                    </TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.total_expected_amount)}</TableCell>
                    <TableCell align="right" className="font-mono">{'£'}{fmt(row.total_counted_amount)}</TableCell>
                    <TableCell
                      align="right"
                      className={`font-mono font-bold ${row.total_variance_amount < 0 ? 'text-danger-fg' : row.total_variance_amount > 0 ? 'text-success-fg' : ''}`}
                    >
                      {'£'}{fmt(row.total_variance_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={statusTone(row.status)} dot>{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="bg-surface-2 font-semibold">
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell align="right" className="font-mono font-bold">{'£'}{fmt(totals.expected)}</TableCell>
                  <TableCell align="right" className="font-mono font-bold">{'£'}{fmt(totals.counted)}</TableCell>
                  <TableCell
                    align="right"
                    className={`font-mono font-bold ${totals.variance < 0 ? 'text-danger-fg' : totals.variance > 0 ? 'text-success-fg' : ''}`}
                  >
                    {'£'}{fmt(totals.variance)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Category stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardBody>
            <Stat label="Weekly Expected" value={`£${fmt(totals.expected)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Weekly Counted" value={`£${fmt(totals.counted)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Weekly Variance"
              value={`£${fmt(totals.variance)}`}
              className={totals.variance >= 0 ? 'text-success-fg' : 'text-danger-fg'}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
