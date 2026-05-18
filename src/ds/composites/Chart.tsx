'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
} from 'recharts'

/* ---------- RevenueChart ---------- */

interface RevenueChartProps {
  data: { day: string; amount: number }[]
}

function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="text-text-muted mb-0.5">{label}</p>
      <p className="text-text-strong font-semibold">
        {'£'}{payload[0].value.toLocaleString()}
      </p>
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={14}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <RechartsTooltip
          content={<ChartTooltipContent />}
          cursor={{ fill: 'var(--color-surface-hover)' }}
        />
        <Bar
          dataKey="amount"
          fill="var(--color-primary)"
          radius={[4, 4, 2, 2]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ---------- Sparkline ---------- */

interface SparklineProps {
  data: number[]
  color?: string
}

export function Sparkline({ data, color }: SparklineProps) {
  const chartData = data.map((y, i) => ({ x: i, y }))
  const stroke = color || 'var(--color-primary)'

  return (
    <ResponsiveContainer width={100} height={32}>
      <AreaChart data={chartData}>
        <Area
          dataKey="y"
          stroke={stroke}
          fill={stroke}
          fillOpacity={0.14}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
