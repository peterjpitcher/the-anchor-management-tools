'use client'

import { useState, useCallback } from 'react'
import {
  BarChart,
  Card,
  CardHeader,
  CardBody,
  ChartTooltipRow,
  ComboChart,
  PageLayout,
  RevenueChart,
  StatGrid,
  type ChartSeries,
  type ChartTooltipItem,
} from '@/ds'
import { Alert, Empty, PageLoading, Select, Stat } from '@/ds'
import { getInsightsDataAction } from '@/app/actions/cashing-up'
import type { CashupInsightsData, CashupInsightsPeriod } from '@/types/cashing-up'
import { cashingUpLayout } from '../../_shared/nav'

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

// Chart series tokens: sky for drinks, the brand green for food, amber for other, the same
// hues the chart used before tokens existed.
const SALES_MIX_COLORS = {
  drinks: 'var(--color-chart-2)',
  food: 'var(--color-chart-1)',
  other: 'var(--color-chart-3)',
}

// The sales mix cards under the chart must match its bars. The service still sends its own
// colour with each row, so that is only the fallback for a category this map does not know.
const SALES_MIX_COLORS_BY_LABEL: Record<string, string> = {
  Drinks: SALES_MIX_COLORS.drinks,
  Food: SALES_MIX_COLORS.food,
  Other: SALES_MIX_COLORS.other,
}

type SalesMixChartPoint = CashupInsightsData['salesMixMonthly'][number]

function formatCurrency(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatPreciseCurrency(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

/** Sales in pounds as bars on the left axis; each category's share of sales as a line on the right. */
const SALES_MIX_SERIES: ChartSeries[] = [
  { key: 'drinksSales', label: 'Drinks sales', color: SALES_MIX_COLORS.drinks, format: formatPreciseCurrency },
  { key: 'foodSales', label: 'Food sales', color: SALES_MIX_COLORS.food, format: formatPreciseCurrency },
  { key: 'otherSales', label: 'Other sales', color: SALES_MIX_COLORS.other, format: formatPreciseCurrency },
  { key: 'drinksPercentage', label: 'Drinks %', type: 'line', axis: 'right', color: SALES_MIX_COLORS.drinks, format: formatPercent },
  { key: 'foodPercentage', label: 'Food %', type: 'line', axis: 'right', color: SALES_MIX_COLORS.food, format: formatPercent },
  { key: 'otherPercentage', label: 'Other %', type: 'line', axis: 'right', color: SALES_MIX_COLORS.other, format: formatPercent, dashed: true },
]

/** The tooltip body: the three sales figures, then the three shares, then the month's total. */
function SalesMixTooltipBody({ row, items }: { row: SalesMixChartPoint; items: ChartTooltipItem[] }) {
  const sales = items.filter((item) => item.key.endsWith('Sales'))
  const shares = items.filter((item) => item.key.endsWith('Percentage'))
  return (
    <>
      {sales.map((item) => (
        <ChartTooltipRow key={item.key} color={item.color} label={item.label} value={item.formatted} />
      ))}
      <div className="space-y-1 border-t border-border pt-1">
        {shares.map((item) => (
          <ChartTooltipRow key={item.key} label={item.label} value={item.formatted} />
        ))}
      </div>
      <div className="border-t border-border pt-1">
        <ChartTooltipRow label="Total" value={formatPreciseCurrency(row.totalSales)} />
      </div>
    </>
  )
}

function SalesMixTrendChart({ data }: { data: SalesMixChartPoint[] }) {
  return (
    <ComboChart
      data={data}
      xKey="monthLabel"
      series={SALES_MIX_SERIES}
      height={320}
      leftAxis={{ format: formatCurrency }}
      rightAxis={{ format: (value) => `${value}%`, domain: [0, 100] }}
      barCategoryGap="26%"
      ariaLabel="Monthly drinks, food and other sales, with each one's share of sales"
      renderTooltip={({ row, items }) => <SalesMixTooltipBody row={row} items={items} />}
    />
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
  const [loadError, setLoadError] = useState<string | undefined>(error)

  const handlePeriodChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = e.target.value as PeriodSelectValue
    const nextPeriod = parsePeriodSelectValue(nextValue)
    setPeriodValue(nextValue)
    setLoading(true)
    try {
      const res = await getInsightsDataAction(undefined, nextPeriod.year, nextPeriod.period)
      setData(res.data ?? null)
      // A failed read is shown as a failure, never as "no data".
      setLoadError(res.data ? undefined : res.error)
    } catch {
      setData(null)
      setLoadError('Could not load insights for that period. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const layoutProps = cashingUpLayout('Insights: trends in takings, sales mix and payment methods')

  // The period picker stays above every state, so a failed period can be swapped for another.
  const periodPicker = (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        label="Period"
        options={periodOptions}
        value={periodValue}
        onChange={handlePeriodChange}
        disabled={loading}
        className="w-52"
      />
    </div>
  )

  if (loading || loadError || !data) {
    return (
      <PageLayout {...layoutProps}>
        {periodPicker}
        {loading ? (
          <PageLoading inline label="Loading insights" />
        ) : loadError ? (
          <Alert tone="danger">{loadError}</Alert>
        ) : (
          <Card>
            <Empty size="sm" title="No takings for this period" description="No cash-ups were recorded in this period." />
          </Card>
        )}
      </PageLayout>
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
    <PageLayout {...layoutProps}>
      {periodPicker}

      {/* Monthly trend chart */}
      <Card>
        <CardHeader title="Monthly Takings Trend" subtitle={periodSubtitle(periodValue)} />
        <CardBody>
          {chartData.length > 0 ? (
            <RevenueChart data={chartData} />
          ) : (
            <Empty size="sm" title="No takings for this period" description="No cash-ups were recorded in this period." />
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
                  <div key={mix.label} className="flex items-center justify-between rounded-default border border-border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: SALES_MIX_COLORS_BY_LABEL[mix.label] ?? mix.color }}
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
            <Empty size="sm" title="No sales mix for this period" description="No sales split was recorded in this period." />
          )}
        </CardBody>
      </Card>

      {/* Day of week analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Average Takings by Day" />
          <CardBody>
            {data.dayOfWeek.length > 0 ? (
              <BarChart
                horizontal
                data={data.dayOfWeek.map((d) => ({ label: d.dayName.substring(0, 3), value: d.avgTakings }))}
                height={data.dayOfWeek.length * 32 + 40}
                valueFormatter={formatCurrency}
                seriesLabel="Average takings"
                ariaLabel="Average takings by day of the week"
              />
            ) : (
              <Empty size="sm" title="No takings for this period" description="No cash-ups were recorded in this period." />
            )}
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
      <StatGrid columns={3}>
        <Stat label="Best Day" value={bestDay?.dayName.substring(0, 3) || '-'} hint={bestDay ? `Avg £${bestDay.avgTakings.toFixed(0)}` : undefined} />
        <Stat label="Avg Daily Takings" value={`£${(totalAvgTakings / (data.dayOfWeek.length || 1)).toFixed(0)}`} />
        <Stat label="Payment Methods" value={data.paymentMix.length} />
      </StatGrid>
    </PageLayout>
  )
}
