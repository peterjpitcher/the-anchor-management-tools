'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardBody, CardHeader, Empty, Segmented, Stat, StatGrid } from '@/ds'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'
import {
  BANK_BALANCE_RANGES,
  filterBankBalancePoints,
  type BankBalancePoint,
  type BankBalanceRange,
} from '@/lib/receipts/bank-balance'

type Props = {
  points: BankBalancePoint[]
  sourceRowCount: number
  canManage: boolean
}

const BANK_BALANCE_SUBTITLE = 'How the account balance has moved across imported bank statements'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactCurrencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

const fullDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const monthDateFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
})

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

function formatFullDate(value: string): string {
  return fullDateFormatter.format(utcDate(value))
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: BankBalancePoint }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs text-text-muted">{formatFullDate(point.date)}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-text-strong">
        {currencyFormatter.format(point.balance)}
      </p>
    </div>
  )
}

export function BankBalanceClient({ points, sourceRowCount, canManage }: Props) {
  const [range, setRange] = useState<BankBalanceRange>('1y')
  const visiblePoints = useMemo(() => filterBankBalancePoints(points, range), [points, range])
  const chrome = { subtitle: BANK_BALANCE_SUBTITLE, navState: { view: 'bank-balance' as const }, canManage }

  if (points.length === 0) {
    return (
      <ReceiptsPageChrome {...chrome}>
        <Card>
          <Empty
            size="sm"
            title="No bank balances available"
            description="Import a bank statement with a Balance column to start this chart."
          />
        </Card>
      </ReceiptsPageChrome>
    )
  }

  const first = visiblePoints[0]
  const latest = visiblePoints.at(-1) ?? first
  const lowest = visiblePoints.reduce((minimum, point) => point.balance < minimum.balance ? point : minimum, first)
  const highest = visiblePoints.reduce((maximum, point) => point.balance > maximum.balance ? point : maximum, first)
  const change = latest.balance - first.balance
  const selectedRange = BANK_BALANCE_RANGES.find((item) => item.key === range)
  const wideDateTicks = range === '1y' || range === '3y' || range === 'all'
  const chartDescription = `Bank balance from ${formatFullDate(first.date)} to ${formatFullDate(latest.date)}, ending at ${currencyFormatter.format(latest.balance)}.`

  return (
    <ReceiptsPageChrome
      {...chrome}
      headerActions={
        <Segmented
          options={BANK_BALANCE_RANGES.map((option) => ({ id: option.key, label: option.label }))}
          value={range}
          onChange={(key) => setRange(key as BankBalanceRange)}
          size="sm"
        />
      }
    >
      <StatGrid columns={3} className="xl:grid-cols-5">
        <Stat
          label="Latest statement balance"
          value={currencyFormatter.format(latest.balance)}
          hint={`${change >= 0 ? '+' : '-'}${currencyFormatter.format(Math.abs(change))} over ${selectedRange?.label.toLowerCase()}. Through ${formatFullDate(latest.date)}`}
        />
        <Stat label="Opening" value={currencyFormatter.format(first.balance)} hint={formatFullDate(first.date)} />
        <Stat label="Lowest" value={currencyFormatter.format(lowest.balance)} hint={formatFullDate(lowest.date)} />
        <Stat label="Highest" value={currencyFormatter.format(highest.balance)} hint={formatFullDate(highest.date)} />
        <Stat
          label="Daily closes"
          value={visiblePoints.length.toLocaleString('en-GB')}
          hint={`${sourceRowCount.toLocaleString('en-GB')} bank entries loaded`}
        />
      </StatGrid>

      <Card>
        <CardHeader title="Balance Over Time" subtitle={selectedRange?.label} />
        <CardBody>
          <div className="relative h-[320px] sm:h-[420px]" role="img" aria-label={chartDescription}>
            <p className="sr-only">{chartDescription}</p>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visiblePoints} margin={{ top: 10, right: 16, bottom: 2, left: 4 }}>
                <defs>
                  <linearGradient id="bankBalanceArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                    <stop offset="88%" stopColor="var(--color-primary)" stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 5" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={36}
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickFormatter={(value: string) => (wideDateTicks ? monthDateFormatter : shortDateFormatter).format(utcDate(value))}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={58}
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickFormatter={(value: number) => compactCurrencyFormatter.format(value)}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<BalanceTooltip />} cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '4 4' }} />
                {lowest.balance < 0 && highest.balance > 0 && (
                  <ReferenceLine y={0} stroke="var(--color-danger)" strokeDasharray="5 5" strokeOpacity={0.6} />
                )}
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  fill="url(#bankBalanceArea)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--color-primary)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <ReferenceDot
                  x={latest.date}
                  y={latest.balance}
                  r={4}
                  fill="var(--color-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </ReceiptsPageChrome>
  )
}
