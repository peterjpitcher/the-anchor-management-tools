'use client'

import { useState, useCallback } from 'react'
import { Card, CardHeader, CardBody, RevenueChart } from '@/ds'
import { Select, Stat } from '@/ds'
import { getInsightsDataAction } from '@/app/actions/cashing-up'

interface InsightsData {
  dayOfWeek: Array<{ dayName: string; avgTakings: number; avgVariance: number }>
  paymentMix: Array<{ label: string; value: number; color: string; percentage: number }>
  monthlyGrowth: Array<{ monthLabel: string; totalTakings: number; targetTakings?: number }>
}

interface Props {
  initialData: InsightsData | null
  selectedYear?: number
  error?: string
}

export function InsightsClient({ initialData, selectedYear, error }: Props) {
  const currentYear = new Date().getFullYear()
  const START_YEAR = 2019
  const yearOptions = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => ({
    value: String(START_YEAR + i),
    label: String(START_YEAR + i),
  }))
  yearOptions.unshift({ value: '', label: 'Last 12 Months' })

  const [data, setData] = useState<InsightsData | null>(initialData)
  const [year, setYear] = useState(selectedYear?.toString() || '')
  const [loading, setLoading] = useState(false)

  const handleYearChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = e.target.value
    setYear(newYear)
    setLoading(true)
    try {
      const res = await getInsightsDataAction(undefined, newYear ? parseInt(newYear) : undefined)
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

  // Day of week stats
  const bestDay = [...data.dayOfWeek].sort((a, b) => b.avgTakings - a.avgTakings)[0]
  const totalAvgTakings = data.dayOfWeek.reduce((sum, d) => sum + d.avgTakings, 0)

  return (
    <div className="space-y-6">
      {/* Year picker */}
      <div className="flex items-center gap-3">
        <Select
          label="Period"
          options={yearOptions}
          value={year}
          onChange={handleYearChange}
          disabled={loading}
          className="w-48"
        />
      </div>

      {/* Monthly trend chart */}
      <Card>
        <CardHeader title="Monthly Takings Trend" subtitle={year ? `Year ${year}` : 'Last 12 months'} />
        <CardBody>
          {chartData.length > 0 ? (
            <RevenueChart data={chartData} />
          ) : (
            <p className="text-text-muted text-center py-8">No data available</p>
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
