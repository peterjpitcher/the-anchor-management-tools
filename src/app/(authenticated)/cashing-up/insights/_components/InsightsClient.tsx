'use client'

import { useState, useCallback } from 'react'
import { Card, CardHeader, CardBody, RevenueChart } from '@/ds'
import { Select, Stat } from '@/ds'
import { getInsightsDataAction } from '@/app/actions/cashing-up'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CashupInsightsData, CashupInsightsPeriod } from '@/types/cashing-up'

type InsightsData = CashupInsightsData
type PeriodSelectValue = `period:${CashupInsightsPeriod}` | `year:${number}`

const PERIOD_OPTIONS: Array<{ value: PeriodSelectValue; label: string }> = [
  { value: 'period:30d', label: 'Last 30 days' },
  { value: 'period:90d', label: 'Last 90 days' },
  { value: 'period:180d', label: 'Last 180 days' },
  { value: 'period:365d', label: 'Last 365 days' },
  { value: 'period:12m', label: 'Last 12 months' },
]

const PERIOD_LABELS: Record<CashupInsightsPeriod, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '180d': 'Last 180 days',
  '365d': 'Last 365 days',
  '12m': 'Last 12 months',
}

const SALES_MIX_COLORS = {
  drinks: '#2563EB',
  food: '#16A34A',
  other: '#F59E0B',
}

type SalesMixChartPoint = CashupInsightsData['salesMixMonthly'][number]
type SalesMixTooltipPayload = Array<{
  color?: string
  dataKey?: string
  name?: string
  payload?: SalesMixChartPoint
  value?: number
}>

function formatCurrency(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatPreciseCurrency(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function SalesMixTooltip({ active, payload, label }: {
  active?: boolean
  payload?: SalesMixTooltipPayload
  label?: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const salesEntries = payload.filter((entry) => entry.dataKey?.endsWith('Sales'))
  const percentEntries = payload.filter((entry) => entry.dataKey?.endsWith('Percentage'))

  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2 shadow-lg text-xs min-w-[180px]">
      <p className="text-text-muted mb-2">{label}</p>
      <div className="space-y-1.5">
        {salesEntries.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-text">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono text-text-strong">{formatPreciseCurrency(Number(entry.value ?? 0))}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-2 space-y-1.5">
        {percentEntries.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="text-text-muted">{entry.name}</span>
            <span className="font-mono text-text-strong">{formatPercent(Number(entry.value ?? 0))}</span>
          </div>
        ))}
      </div>
      {point && (
        <div className="mt-2 border-t border-border pt-2 flex items-center justify-between gap-4">
          <span className="text-text-muted">Total</span>
          <span className="font-mono text-text-strong">{formatPreciseCurrency(point.totalSales)}</span>
        </div>
      )}
    </div>
  )
}

function SalesMixTrendChart({ data }: { data: SalesMixChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 18, right: 32, bottom: 4, left: 8 }} barCategoryGap="26%">
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="amount"
          tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
          tickFormatter={formatCurrency}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <YAxis
          yAxisId="percent"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
          tickFormatter={(value) => `${value}%`}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <RechartsTooltip content={<SalesMixTooltip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar yAxisId="amount" dataKey="drinksSales" name="Drinks sales" fill={SALES_MIX_COLORS.drinks} radius={[3, 3, 0, 0]} />
        <Bar yAxisId="amount" dataKey="foodSales" name="Food sales" fill={SALES_MIX_COLORS.food} radius={[3, 3, 0, 0]} />
        <Bar yAxisId="amount" dataKey="otherSales" name="Other sales" fill={SALES_MIX_COLORS.other} radius={[3, 3, 0, 0]} />
        <Line yAxisId="percent" type="monotone" dataKey="drinksPercentage" name="Drinks %" stroke={SALES_MIX_COLORS.drinks} strokeWidth={2} dot={false} />
        <Line yAxisId="percent" type="monotone" dataKey="foodPercentage" name="Food %" stroke={SALES_MIX_COLORS.food} strokeWidth={2} dot={false} />
        <Line yAxisId="percent" type="monotone" dataKey="otherPercentage" name="Other %" stroke={SALES_MIX_COLORS.other} strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

interface Props {
  initialData: InsightsData | null
  selectedYear?: number
  selectedPeriod?: CashupInsightsPeriod
  error?: string
}

function parsePeriodSelectValue(value: string): { year?: number; period?: CashupInsightsPeriod } {
  if (value.startsWith('year:')) {
    return { year: parseInt(value.replace('year:', ''), 10) }
  }
  return { period: value.replace('period:', '') as CashupInsightsPeriod }
}

function periodSubtitle(value: PeriodSelectValue) {
  const parsed = parsePeriodSelectValue(value)
  return parsed.year ? `Year ${parsed.year}` : PERIOD_LABELS[parsed.period ?? '12m']
}

export function InsightsClient({ initialData, selectedYear, selectedPeriod = '12m', error }: Props) {
  const currentYear = new Date().getFullYear()
  const START_YEAR = 2019
  const yearOptions = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => ({
    value: `year:${START_YEAR + i}` as PeriodSelectValue,
    label: String(START_YEAR + i),
  }))
  const periodOptions = [...PERIOD_OPTIONS, ...yearOptions]
  const initialPeriodValue = selectedYear
    ? `year:${selectedYear}` as PeriodSelectValue
    : `period:${selectedPeriod}` as PeriodSelectValue

  const [data, setData] = useState<InsightsData | null>(initialData)
  const [periodValue, setPeriodValue] = useState<PeriodSelectValue>(initialPeriodValue)
  const [loading, setLoading] = useState(false)

  const handlePeriodChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = e.target.value as PeriodSelectValue
    const nextPeriod = parsePeriodSelectValue(nextValue)
    setPeriodValue(nextValue)
    setLoading(true)
    try {
      const res = await getInsightsDataAction(undefined, nextPeriod.year, nextPeriod.period)
      setData(res.data ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  if (error || !data) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-center py-8">{error || 'No insights data available.'}</p>
        </CardBody>
      </Card>
    )
  }

  // Transform monthly growth data for RevenueChart
  const chartData = data.monthlyGrowth.map((d) => ({
    day: d.monthLabel,
    amount: d.totalTakings,
    target: d.targetTakings,
  }))
  const salesMix = data.salesMix ?? []
  const salesMixMonthly = data.salesMixMonthly ?? []
  const hasSalesMixData = salesMixMonthly.some((mix) => mix.totalSales > 0)

  // Day of week stats
  const bestDay = [...data.dayOfWeek].sort((a, b) => b.avgTakings - a.avgTakings)[0]
  const totalAvgTakings = data.dayOfWeek.reduce((sum, d) => sum + d.avgTakings, 0)

  return (
    <div className="space-y-6">
      {/* Year picker */}
      <div className="flex items-center gap-3">
        <Select
          label="Period"
          options={periodOptions}
          value={periodValue}
          onChange={handlePeriodChange}
          disabled={loading}
          className="w-52"
        />
      </div>

      {/* Monthly trend chart */}
      <Card>
        <CardHeader title="Monthly Takings Trend" subtitle={periodSubtitle(periodValue)} />
        <CardBody>
          {chartData.length > 0 ? (
            <RevenueChart data={chartData} />
          ) : (
            <p className="text-text-muted text-center py-8">No data available</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sales Mix" subtitle="Monthly drinks, food, and other sales with split percentage" />
        <CardBody>
          {hasSalesMixData ? (
            <div className="space-y-4">
              <SalesMixTrendChart data={salesMixMonthly} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {salesMix.map((mix) => (
                  <div key={mix.label} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: mix.color }}
                      />
                      <span className="text-sm font-medium text-text truncate">{mix.label}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-text">{mix.percentage.toFixed(1)}%</div>
                      <div className="text-xs text-text-muted font-mono">
                        {'£'}{mix.value.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-text-muted text-center py-8">No sales mix data available</p>
          )}
        </CardBody>
      </Card>

      {/* Day of week analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Average Takings by Day" />
          <CardBody>
            <div className="space-y-3">
              {data.dayOfWeek.map((d) => (
                <div key={d.dayName} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">{d.dayName.substring(0, 3)}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-surface-hover rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${totalAvgTakings > 0 ? (d.avgTakings / (bestDay?.avgTakings || 1)) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono text-text-muted w-20 text-right">
                      {'£'}{d.avgTakings.toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment Method Mix" />
          <CardBody>
            <div className="space-y-4">
              {data.paymentMix.map((mix) => (
                <div key={mix.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: mix.color }}
                    />
                    <span className="text-sm text-text">{mix.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{mix.percentage.toFixed(1)}%</span>
                    <span className="text-xs text-text-muted font-mono">
                      {'£'}{mix.value.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Year-over-year stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardBody>
            <Stat label="Best Day" value={bestDay?.dayName.substring(0, 3) || '-'} hint={bestDay ? `Avg £${bestDay.avgTakings.toFixed(0)}` : undefined} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Avg Daily Takings" value={`£${(totalAvgTakings / (data.dayOfWeek.length || 1)).toFixed(0)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Payment Methods" value={data.paymentMix.length} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
