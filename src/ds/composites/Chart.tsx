'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
} from 'recharts'

/* ---------- RevenueChart ---------- */

interface RevenueChartProps {
  data: { day: string; amount: number; target?: number }[]
}

const GREEN = 'var(--color-primary)'
const RED = '#ef4444'

/**
 * Custom bar shape: coloured bar + a target marker line.
 *
 * Recharts gives us:
 *   y      = pixel top of the bar (maps to `amount` value)
 *   height = pixel height of the bar (maps from 0 → amount)
 *   y + height = pixel bottom of the chart (the 0 line)
 *
 * So pixelsPerUnit = height / amount, and:
 *   targetY = (y + height) - target × (height / amount)
 *
 * When target > amount the line sits above the bar.
 * When target < amount the line sits inside the bar.
 */
function BarWithTargetLine(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: { amount: number; target?: number }
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  const target = payload?.target ?? 0
  const amount = payload?.amount ?? 0
  const missedTarget = target > 0 && amount < target
  const fill = missedTarget ? RED : GREEN
  const r = Math.min(4, height / 2)

  // Target line position using the bar's own proportional scale
  const bottom = y + height
  const targetY = target > 0 && amount > 0
    ? bottom - target * (height / amount)
    : 0

  return (
    <g>
      {/* Revenue bar with rounded top corners */}
      {height > 0 && (
        <path
          d={`
            M${x},${y + r}
            Q${x},${y} ${x + r},${y}
            L${x + width - r},${y}
            Q${x + width},${y} ${x + width},${y + r}
            L${x + width},${bottom}
            L${x},${bottom}
            Z
          `}
          fill={fill}
        />
      )}
      {/* Target marker line — dashed, extends slightly past bar edges */}
      {target > 0 && amount > 0 && (
        <line
          x1={x - 3}
          x2={x + width + 3}
          y1={targetY}
          y2={targetY}
          stroke="#1e293b"
          strokeWidth={2}
          strokeDasharray="4 2"
          opacity={0.55}
        />
      )}
    </g>
  )
}

function ChartTooltipContent({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; payload?: { amount: number; target?: number } }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const amount = entry?.payload?.amount ?? 0
  const target = entry?.payload?.target ?? 0
  const metTarget = target > 0 && amount >= target
  const missedTarget = target > 0 && amount < target
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 shadow-lg text-xs min-w-[120px]">
      <p className="text-text-muted mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: missedTarget ? RED : GREEN }} />
        <span className="text-text-strong font-semibold">
          {'£'}{amount.toLocaleString()}
        </span>
      </div>
      {target > 0 && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-block w-2 shrink-0 border-t-2 border-dashed border-slate-700 opacity-60" />
          <span className="text-text-muted">
            Target: {'£'}{target.toLocaleString()}
            {metTarget && <span className="text-green-600 ml-1">✓</span>}
          </span>
        </div>
      )}
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  const hasTargets = data.some(d => (d.target ?? 0) > 0)
  // Domain must include target values so bars that missed target still have room above
  const maxValue = Math.max(...data.map(d => Math.max(d.amount, d.target ?? 0)))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={28}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={[0, maxValue * 1.1]} />
        <RechartsTooltip
          content={<ChartTooltipContent />}
          cursor={{ fill: 'var(--color-surface-hover)' }}
        />
        {hasTargets ? (
          <Bar dataKey="amount" shape={<BarWithTargetLine />}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={(d.target ?? 0) > 0 && d.amount < (d.target ?? 0) ? RED : GREEN}
              />
            ))}
          </Bar>
        ) : (
          <Bar
            dataKey="amount"
            fill={GREEN}
            radius={[4, 4, 2, 2]}
          />
        )}
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
