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
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { EmptyState } from '@/ds'
import {
  BANK_BALANCE_RANGES,
  filterBankBalancePoints,
  type BankBalancePoint,
  type BankBalanceRange,
} from '@/lib/receipts/bank-balance'

type Props = {
  points: BankBalancePoint[]
  sourceRowCount: number
}

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

function SummaryItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0 sm:border-l sm:border-border sm:first:border-l-0">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-text-strong">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-text-muted">{detail}</p>}
    </div>
  )
}

export function BankBalanceClient({ points, sourceRowCount }: Props) {
  const [range, setRange] = useState<BankBalanceRange>('1y')
  const visiblePoints = useMemo(() => filterBankBalancePoints(points, range), [points, range])

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          title="No bank balances available"
          description="Import a bank statement with a Balance column to start this chart."
        />
      </div>
    )
  }

  const first = visiblePoints[0]
  const latest = visiblePoints.at(-1) ?? first
  const lowest = visiblePoints.reduce((minimum, point) => point.balance < minimum.balance ? point : minimum, first)
  const highest = visiblePoints.reduce((maximum, point) => point.balance > maximum.balance ? point : maximum, first)
  const change = latest.balance - first.balance
  const positiveChange = change >= 0
  const selectedRange = BANK_BALANCE_RANGES.find((item) => item.key === range)
  const wideDateTicks = range === '1y' || range === '3y' || range === 'all'
  const chartDescription = `Bank balance from ${formatFullDate(first.date)} to ${formatFullDate(latest.date)}, ending at ${currencyFormatter.format(latest.balance)}.`

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              Latest statement balance
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-text-strong sm:text-4xl">
                {currencyFormatter.format(latest.balance)}
              </p>
              <span className={clsx(
                'inline-flex items-center gap-1 text-sm font-semibold',
                positiveChange ? 'text-success-fg' : 'text-danger-fg',
              )}>
                {positiveChange
                  ? <ArrowTrendingUpIcon className="h-4 w-4" aria-hidden="true" />
                  : <ArrowTrendingDownIcon className="h-4 w-4" aria-hidden="true" />}
                {change >= 0 ? '+' : '-'}{currencyFormatter.format(Math.abs(change))}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Through {formatFullDate(latest.date)} · change over {selectedRange?.label.toLowerCase()}
            </p>
          </div>

          <div
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1"
            role="group"
            aria-label="Bank balance time range"
          >
            {BANK_BALANCE_RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={range === option.key}
                onClick={() => setRange(option.key)}
                className={clsx(
                  'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  range === option.key
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-strong',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 border-t border-border sm:grid-cols-4">
          <SummaryItem label="Opening" value={currencyFormatter.format(first.balance)} detail={formatFullDate(first.date)} />
          <SummaryItem label="Lowest" value={currencyFormatter.format(lowest.balance)} detail={formatFullDate(lowest.date)} />
          <SummaryItem label="Highest" value={currencyFormatter.format(highest.balance)} detail={formatFullDate(highest.date)} />
          <SummaryItem label="Daily closes" value={visiblePoints.length.toLocaleString('en-GB')} detail={`${sourceRowCount.toLocaleString('en-GB')} bank entries loaded`} />
        </div>
      </div>

      <div className="relative h-[320px] px-1 py-5 sm:h-[420px] sm:px-4" role="img" aria-label={chartDescription}>
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
    </section>
  )
}
