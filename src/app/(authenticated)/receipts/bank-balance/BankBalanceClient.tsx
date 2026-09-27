'use client'

import { useMemo, useState } from 'react'
import { Card, CardBody, CardHeader, Empty, LineChart, Segmented, Stat, StatGrid, type ChartSeries } from '@/ds'
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

const BANK_BALANCE_SUBTITLE = 'Bank Balance: how the account balance has moved across imported bank statements'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

const BALANCE_SERIES: ChartSeries[] = [{ key: 'balance', label: 'Balance', type: 'area', format: 'currency' }]

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
            title="No bank balances yet"
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
  // The change as a percentage of the opening balance, for the Stat arrow: up is green, down red.
  const changePercent = first.balance !== 0 ? Math.round((change / Math.abs(first.balance)) * 1000) / 10 : undefined
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
          aria-label="Date range"
        />
      }
    >
      <StatGrid columns={5}>
        <Stat
          label="Latest statement balance"
          value={currencyFormatter.format(latest.balance)}
          delta={changePercent}
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
          <LineChart
            data={visiblePoints}
            xKey="date"
            series={BALANCE_SERIES}
            heightClassName="h-[320px] sm:h-[420px]"
            formatX={(value) => (wideDateTicks ? monthDateFormatter : shortDateFormatter).format(utcDate(value))}
            formatTooltipLabel={formatFullDate}
            xMinTickGap={36}
            leftAxis={{ format: 'shorthandCurrency', domain: ['auto', 'auto'], width: 58 }}
            referenceLines={lowest.balance < 0 && highest.balance > 0 ? [{ value: 0, tone: 'danger' }] : undefined}
            markLastPoint
            ariaLabel={chartDescription}
          />
        </CardBody>
      </Card>
    </ReceiptsPageChrome>
  )
}
