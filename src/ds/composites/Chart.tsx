'use client'

import { useId, type ReactNode } from 'react'
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  ComposedChart,
  Bar,
  Line,
  Cell,
  CartesianGrid,
  LabelList,
  Rectangle,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  type BarShapeProps,
  type MouseHandlerDataParam,
  type TooltipContentProps,
} from 'recharts'
import { cn } from '@/lib/utils'

/* ---------- RevenueChart ---------- */

interface RevenueChartProps {
  data: { day: string; amount: number; target?: number }[]
  /** Formats tooltip values. Defaults to pounds, e.g. £1,234. */
  valueFormatter?: (value: number) => string
  height?: number
  barSize?: number
}

const defaultValueFormatter = (value: number): string => `£${value.toLocaleString()}`

const GREEN = 'var(--color-primary)'
const RED = 'var(--color-danger)'

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
      {/* Target marker line: dashed, extends slightly past bar edges */}
      {target > 0 && amount > 0 && (
        <line
          x1={x - 3}
          x2={x + width + 3}
          y1={targetY}
          y2={targetY}
          stroke="var(--color-text)"
          strokeWidth={2}
          strokeDasharray="4 2"
          opacity={0.55}
        />
      )}
    </g>
  )
}

function ChartTooltipContent({ active, payload, label, valueFormatter = defaultValueFormatter }: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; payload?: { amount: number; target?: number } }>
  label?: string
  valueFormatter?: (value: number) => string
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
          {valueFormatter(amount)}
        </span>
      </div>
      {target > 0 && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-block w-2 shrink-0 border-t-2 border-dashed border-text opacity-60" />
          <span className="text-text-muted">
            Target: {valueFormatter(target)}
            {metTarget && <span className="text-success-fg ml-1">✓</span>}
          </span>
        </div>
      )}
    </div>
  )
}

export function RevenueChart({
  data,
  valueFormatter = defaultValueFormatter,
  height = 160,
  barSize = 28,
}: RevenueChartProps) {
  const hasTargets = data.some(d => (d.target ?? 0) > 0)
  // Domain must include target values so bars that missed target still have room above
  const maxValue = Math.max(...data.map(d => Math.max(d.amount, d.target ?? 0)))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} barSize={barSize}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={[0, maxValue * 1.1]} />
        <RechartsTooltip
          content={<ChartTooltipContent valueFormatter={valueFormatter} />}
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
      </RechartsBarChart>
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

/* ================================================================== */
/*  Chart composites: one visual language for every data chart         */
/*                                                                    */
/*  BarChart, LineChart and ComboChart share the series colours        */
/*  (--color-chart-1..6), axes, grid, tooltip, legend and number       */
/*  formatting below. RevenueChart and Sparkline above keep their      */
/*  own compact looks.                                                 */
/* ================================================================== */

/** The six chart series colours, in order. A series without its own colour takes the next one. */
export const CHART_COLOURS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
] as const

/** The series colour for a position, cycling through `CHART_COLOURS`. */
export function chartColour(index: number): string {
  return CHART_COLOURS[((index % CHART_COLOURS.length) + CHART_COLOURS.length) % CHART_COLOURS.length]
}

/**
 * How a chart prints a number on an axis, a bar label or in the tooltip:
 * - `number`: 1,234.5 (en-GB grouping)
 * - `currency`: £1,234.50
 * - `shorthandCurrency`: £950, £1.2k, £3.4M
 * - `percent`: 12.5%
 * - or your own function.
 */
export type ChartValueFormat =
  | 'number'
  | 'currency'
  | 'shorthandCurrency'
  | 'percent'
  | ((value: number) => string)

function shorthandPounds(value: number): string {
  const size = Math.abs(value)
  if (size >= 1_000_000) return `£${(size / 1_000_000).toFixed(1)}M`
  if (size >= 1_000) return `£${(size / 1_000).toFixed(1)}k`
  return `£${size.toFixed(0)}`
}

/** Formats a chart number (see `ChartValueFormat`). Non-numbers print as an empty string. */
export function formatChartValue(value: number, format: ChartValueFormat = 'number'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  if (typeof format === 'function') return format(value)
  const sign = value < 0 ? '-' : ''
  switch (format) {
    case 'currency':
      return `${sign}£${Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'shorthandCurrency':
      return `${sign}${shorthandPounds(value)}`
    case 'percent':
      return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`
    default:
      return value.toLocaleString('en-GB')
  }
}

/**
 * A value axis that starts at zero (or below it for negative values), leaves about 10% headroom
 * and ends on a round step, so the ticks read 0, 250, 500 rather than 0, 237, 474.
 */
export function niceChartDomain(values: number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value))
  const min = Math.min(0, ...finite)
  const max = Math.max(0, ...finite)
  if (min === max) return [0, 1]
  const padding = (max - min) * 0.1
  const paddedMin = min < 0 ? min - padding : 0
  const paddedMax = max > 0 ? max + padding : 0
  const rawStep = (paddedMax - paddedMin) / 5
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const scaled = rawStep / magnitude
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * magnitude
  return [Math.floor(paddedMin / step) * step, Math.ceil(paddedMax / step) * step]
}

/** The index of the category a chart click landed on, or null when it missed every category. */
export function chartClickIndex(state: Pick<MouseHandlerDataParam, 'activeTooltipIndex'> | null | undefined, length: number): number | null {
  const raw = state?.activeTooltipIndex
  if (raw === undefined || raw === null || raw === '') return null
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 && index < length ? index : null
}

/* --- Shared look --- */

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' }
const GRID_STROKE = 'var(--color-border)'
const GRID_DASH = '3 5'
const BAR_CURSOR = { fill: 'var(--color-surface-hover)' }
const LINE_CURSOR = { stroke: 'var(--color-border-strong)', strokeDasharray: '4 4' }
const ZERO_LINE = 'var(--color-border-strong)'
const TARGET_STROKE = 'var(--color-text)'
const CHART_MARGIN = { top: 12, right: 16, bottom: 4, left: 4 }

/** One row of the chart tooltip: a colour key, a name and a value. Use it in `renderTooltip`. */
export function ChartTooltipRow({
  color,
  label,
  value,
  dashed = false,
}: {
  color?: string
  label: ReactNode
  value: ReactNode
  /** Draw the key as a dashed line, for a target or a dashed series. */
  dashed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-1.5 text-text-muted">
        {color && (
          dashed ? (
            <span className="inline-block w-2.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />
          ) : (
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          )
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums text-text-strong">{value}</span>
    </div>
  )
}

/** The tooltip card every DS chart uses: a muted title over rows or custom content. */
export function ChartTooltipFrame({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-[140px] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {title !== undefined && title !== null && title !== '' && <p className="mb-1 text-text-muted">{title}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  )
}

type LegendItem = { key: string; label: string; color: string; kind: 'bar' | 'line' | 'area'; dashed?: boolean }

function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-text-muted">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          {item.kind === 'bar' ? (
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
          ) : (
            <span
              className={cn('inline-block w-3 shrink-0 border-t-2', item.dashed && 'border-dashed')}
              style={{ borderColor: item.color }}
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Wraps a chart at a fixed or responsive height, named for screen readers when `ariaLabel` is set.
 * The name goes on a `figure`, not an `img`: an image hides everything inside it, but recharts
 * makes the chart itself a keyboard stop (arrow keys walk the tooltip), which must stay reachable.
 */
function ChartFrame({
  height,
  heightClassName,
  ariaLabel,
  className,
  clickable,
  legend,
  children,
}: {
  height: number
  heightClassName?: string
  ariaLabel?: string
  className?: string
  clickable?: boolean
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn('w-full min-w-0', className)}
      {...(ariaLabel ? { role: 'figure', 'aria-label': ariaLabel } : {})}
    >
      <div
        className={cn('w-full min-w-0', heightClassName, clickable && 'cursor-pointer')}
        style={heightClassName ? undefined : { height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      {legend}
    </div>
  )
}

/* --- BarChart: single series --- */

export interface BarChartDatum {
  label: string
  value: number
  /** This bar's colour (a token such as `var(--color-chart-2)`); defaults to the chart's `color`. */
  color?: string
  /** Draws a dashed target marker across this bar at the given value. */
  targetLineValue?: number
}

/**
 * Props for `BarChart`, the one single-series bar chart. (It replaced a canvas chart, since
 * deleted, whose first eight props and defaults it kept.)
 *
 * @property data         One bar per item: `label`, `value`, and optionally `color` and `targetLineValue`.
 * @property height       Pixel height (default 300). `heightClassName` overrides it for responsive heights.
 * @property color        Colour for every bar without its own (default `var(--color-chart-1)`).
 * @property showGrid     Grid lines along the value axis (default true).
 * @property showValues   Value labels on the bars (default true); hidden when there are more than 31 bars.
 * @property horizontal   Bars run left to right with the labels down the side (default false).
 * @property formatType   `number` (default), `currency` or `shorthandCurrency`, for the axis, labels and tooltip.
 * @property onBarClick   Called with the bar's index when its column is clicked.
 * @property valueFormatter Your own number format; wins over `formatType`.
 * @property seriesLabel  The value's name in the tooltip (default "Value").
 * @property maxBarSize   Widest a bar may get, in pixels.
 * @property ariaLabel    Names the chart for screen readers (a `figure` with this label).
 * @property heightClassName Height classes such as `h-[320px] sm:h-[420px]`, used instead of `height`.
 * @property className    Classes for the outer wrapper.
 */
export interface BarChartProps {
  data: BarChartDatum[]
  height?: number
  color?: string
  showGrid?: boolean
  showValues?: boolean
  horizontal?: boolean
  formatType?: 'number' | 'currency' | 'shorthandCurrency'
  onBarClick?: (index: number) => void
  valueFormatter?: (value: number) => string
  seriesLabel?: string
  maxBarSize?: number
  ariaLabel?: string
  heightClassName?: string
  className?: string
}

/** Bars rounded at the value end, with the dashed target marker when the datum has one. */
function BarWithTarget(props: BarShapeProps & { domain: [number, number]; horizontal: boolean }) {
  const { domain, horizontal, background, payload, x = 0, y = 0, width = 0, height = 0 } = props
  const target = (payload as BarChartDatum | undefined)?.targetLineValue
  const [low, high] = domain
  let marker: ReactNode = null
  if (typeof target === 'number' && Number.isFinite(target) && background && high > low) {
    if (horizontal) {
      const bgX = Number(background.x ?? 0)
      const bgWidth = Number(background.width ?? 0)
      const markerX = bgX + ((target - low) / (high - low)) * bgWidth
      marker = <line x1={markerX} x2={markerX} y1={y - 3} y2={y + height + 3} stroke={TARGET_STROKE} strokeWidth={2} strokeDasharray="4 2" opacity={0.55} />
    } else {
      const bgY = Number(background.y ?? 0)
      const bgHeight = Number(background.height ?? 0)
      const markerY = bgY + ((high - target) / (high - low)) * bgHeight
      marker = <line x1={x - 3} x2={x + width + 3} y1={markerY} y2={markerY} stroke={TARGET_STROKE} strokeWidth={2} strokeDasharray="4 2" opacity={0.55} />
    }
  }
  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill={props.fill} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
      {marker}
    </g>
  )
}

/**
 * A single-series bar chart in the DS chart style: chart tokens, `formatChartValue` numbers and
 * the shared tooltip frame.
 */
export function BarChart({
  data,
  height = 300,
  color = 'var(--color-chart-1)',
  showGrid = true,
  showValues = true,
  horizontal = false,
  formatType = 'number',
  onBarClick,
  valueFormatter,
  seriesLabel = 'Value',
  maxBarSize,
  ariaLabel,
  heightClassName,
  className,
}: BarChartProps) {
  const format: ChartValueFormat = valueFormatter ?? formatType
  const domain = niceChartDomain(data.flatMap((item) => [item.value, item.targetLineValue ?? 0]))
  const hasTargets = data.some((item) => typeof item.targetLineValue === 'number')
  const shouldShowValues = showValues && data.length <= 31
  const longestLabel = data.reduce((longest, item) => Math.max(longest, item.label.length), 0)
  // Slanted labels when they would collide, and at most about 20 of them, as the canvas chart did.
  const rotateLabels = !horizontal && (data.length > 8 || longestLabel > 12)
  const labelInterval = data.length > 20 ? Math.ceil(data.length / 20) - 1 : 0
  const categoryWidth = Math.min(180, Math.max(60, longestLabel * 7 + 8))
  const formatTick = (value: number) => formatChartValue(value, format)

  const valueAxisProps = {
    type: 'number' as const,
    domain,
    allowDataOverflow: true,
    tickFormatter: formatTick,
    tick: AXIS_TICK,
    axisLine: false,
    tickLine: false,
  }
  const categoryAxisProps = {
    type: 'category' as const,
    dataKey: 'label',
    tick: AXIS_TICK,
    axisLine: false,
    tickLine: false,
  }

  return (
    <ChartFrame height={height} heightClassName={heightClassName} ariaLabel={ariaLabel} className={className} clickable={Boolean(onBarClick)}>
      <RechartsBarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ ...CHART_MARGIN, top: shouldShowValues && !horizontal ? 20 : CHART_MARGIN.top, right: shouldShowValues && horizontal ? 56 : CHART_MARGIN.right }}
        onClick={onBarClick ? (state) => {
          const index = chartClickIndex(state, data.length)
          if (index !== null) onBarClick(index)
        } : undefined}
      >
        {showGrid && (
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray={GRID_DASH} vertical={horizontal} horizontal={!horizontal} />
        )}
        {horizontal ? (
          <>
            <XAxis {...valueAxisProps} />
            <YAxis {...categoryAxisProps} width={categoryWidth} interval={0} />
          </>
        ) : (
          <>
            <XAxis
              {...categoryAxisProps}
              interval={labelInterval}
              angle={rotateLabels ? -40 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? Math.min(96, 24 + longestLabel * 5) : 30}
            />
            <YAxis {...valueAxisProps} width="auto" />
          </>
        )}
        {domain[0] < 0 && (
          horizontal
            ? <ReferenceLine x={0} stroke={ZERO_LINE} />
            : <ReferenceLine y={0} stroke={ZERO_LINE} />
        )}
        <RechartsTooltip
          cursor={BAR_CURSOR}
          content={({ active, payload, label }: TooltipContentProps) => {
            const item = payload?.[0]?.payload as BarChartDatum | undefined
            if (!active || !item) return null
            return (
              <ChartTooltipFrame title={label ?? item.label}>
                <ChartTooltipRow color={item.color ?? color} label={seriesLabel} value={formatChartValue(item.value, format)} />
                {typeof item.targetLineValue === 'number' && (
                  <ChartTooltipRow color={TARGET_STROKE} dashed label="Target" value={formatChartValue(item.targetLineValue, format)} />
                )}
              </ChartTooltipFrame>
            )
          }}
        />
        <Bar
          dataKey="value"
          name={seriesLabel}
          fill={color}
          maxBarSize={maxBarSize}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          isAnimationActive={false}
          shape={hasTargets ? (shapeProps: BarShapeProps) => <BarWithTarget {...shapeProps} domain={domain} horizontal={horizontal} /> : undefined}
        >
          {data.map((item, index) => (
            <Cell key={`${item.label}-${index}`} fill={item.color ?? color} />
          ))}
          {shouldShowValues && (
            <LabelList
              dataKey="value"
              position={horizontal ? 'right' : 'top'}
              formatter={(value) => (typeof value === 'number' ? formatChartValue(value, format) : value)}
              fill="var(--color-text)"
              fontSize={11}
            />
          )}
        </Bar>
      </RechartsBarChart>
    </ChartFrame>
  )
}

/* --- LineChart and ComboChart (shared cartesian chart) --- */

export type ChartDomainBound = number | 'auto' | 'dataMin' | 'dataMax'

export interface ChartAxisOptions {
  /** Tick format, and the tooltip format for the series on this axis (default `number`). */
  format?: ChartValueFormat
  /** Axis range, for example `[0, 100]` or `['auto', 'auto']` (default `[0, 'auto']`). */
  domain?: [ChartDomainBound, ChartDomainBound]
  /** Allow ticks such as 2.5 (default true). */
  allowDecimals?: boolean
  /** Axis width in pixels (default: fits the widest tick). */
  width?: number
}

export interface ChartSeries {
  /** The row field this series plots. */
  key: string
  /** Its name in the legend and the tooltip. */
  label: string
  /** `bar`, `line` or `area` (a line with a soft fill). LineChart defaults to `line`, ComboChart to `bar`. */
  type?: 'bar' | 'line' | 'area'
  /** Its colour, normally a chart token; defaults to `chartColour(position)`. */
  color?: string
  /** Which value axis it uses (default `left`). A right axis is drawn once any series uses it. */
  axis?: 'left' | 'right'
  /** Bars sharing a stack id stack on top of each other; bars without one sit side by side. */
  stackId?: string
  /** Draw the line dashed (lines and areas). */
  dashed?: boolean
  /** Line shape (default `monotone`). */
  curve?: 'monotone' | 'linear' | 'step'
  /** Tooltip format for this series; defaults to its axis's `format`. */
  format?: ChartValueFormat
}

export interface ChartReferenceLine {
  /** Where the line crosses the value axis. */
  value: number
  /** The axis the value belongs to (default `left`). */
  axis?: 'left' | 'right'
  /** `danger` for a limit such as zero on a bank balance; `neutral` otherwise (default). */
  tone?: 'neutral' | 'danger'
  /** Optional text at the line's end. */
  label?: string
}

export interface ChartTooltipItem {
  key: string
  label: string
  value: number
  /** The value in its series format. */
  formatted: string
  color: string
  dashed: boolean
}

export interface ChartTooltipContext<Row> {
  /** The category under the pointer, already formatted by `formatTooltipLabel` or `formatX`. */
  label: string
  /** The data row under the pointer. */
  row: Row
  /** One entry per series with a value at this point, in series order. */
  items: ChartTooltipItem[]
}

type ChartInterval = number | 'preserveStart' | 'preserveEnd' | 'preserveStartEnd' | 'equidistantPreserveStart'

/**
 * Props shared by `LineChart` and `ComboChart`.
 *
 * @property data            The rows, one per category (a day, a week, a month).
 * @property xKey            The row field on the category axis.
 * @property series          What to plot (see `ChartSeries`).
 * @property height          Pixel height (default 300). `heightClassName` overrides it.
 * @property heightClassName Height classes such as `h-[320px] sm:h-[420px]`, for responsive heights.
 * @property formatX         Formats the category ticks (and the tooltip title unless `formatTooltipLabel` is set).
 * @property formatTooltipLabel Formats the tooltip title from the category value and its row.
 * @property xInterval       Which category ticks to show: a number skips that many between ticks (default `preserveStartEnd`).
 * @property xMinTickGap     Smallest gap between category ticks in pixels (default 16).
 * @property leftAxis        The left value axis (see `ChartAxisOptions`).
 * @property rightAxis       The right value axis, drawn when a series has `axis: 'right'`.
 * @property showGrid        Horizontal grid lines (default true).
 * @property showLegend      A legend under the chart (default: when there is more than one series).
 * @property referenceLines  Horizontal marker lines (see `ChartReferenceLine`).
 * @property markLastPoint   Dots the last point of the first line or area series, for "where we are now".
 * @property renderTooltip   Your own tooltip body; the DS tooltip card and title wrap it. Return null to hide it.
 * @property maxBarSize      Widest a bar may get, in pixels.
 * @property barGap          Gap between bars in one category.
 * @property barCategoryGap  Gap between categories (default `10%`).
 * @property onPointClick    Called with the index and row of the clicked category.
 * @property ariaLabel       Names the chart for screen readers (a `figure` with this label).
 * @property className       Classes for the outer wrapper.
 */
export interface CartesianChartProps<Row extends object> {
  data: Row[]
  xKey: keyof Row & string
  series: ChartSeries[]
  height?: number
  heightClassName?: string
  formatX?: (value: string) => string
  formatTooltipLabel?: (value: string, row: Row) => string
  xInterval?: ChartInterval
  xMinTickGap?: number
  leftAxis?: ChartAxisOptions
  rightAxis?: ChartAxisOptions
  showGrid?: boolean
  showLegend?: boolean
  referenceLines?: ChartReferenceLine[]
  markLastPoint?: boolean
  renderTooltip?: (context: ChartTooltipContext<Row>) => ReactNode
  maxBarSize?: number
  barGap?: number | string
  barCategoryGap?: number | string
  onPointClick?: (index: number, row: Row) => void
  ariaLabel?: string
  className?: string
}

export type LineChartProps<Row extends object> = CartesianChartProps<Row>
export type ComboChartProps<Row extends object> = CartesianChartProps<Row>

type ResolvedSeries = ChartSeries & { type: 'bar' | 'line' | 'area'; color: string; axis: 'left' | 'right' }

function CartesianChart<Row extends object>({
  data,
  xKey,
  series,
  defaultType,
  height = 300,
  heightClassName,
  formatX,
  formatTooltipLabel,
  xInterval = 'preserveStartEnd',
  xMinTickGap = 16,
  leftAxis,
  rightAxis,
  showGrid = true,
  showLegend,
  referenceLines,
  markLastPoint = false,
  renderTooltip,
  maxBarSize,
  barGap,
  barCategoryGap,
  onPointClick,
  ariaLabel,
  className,
}: CartesianChartProps<Row> & { defaultType: 'bar' | 'line' }) {
  const gradientPrefix = `chart-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const xDataKey: string = xKey
  const resolved: ResolvedSeries[] = series.map((item, index) => ({
    ...item,
    type: item.type ?? defaultType,
    color: item.color ?? chartColour(index),
    axis: item.axis ?? 'left',
  }))
  const hasBars = resolved.some((item) => item.type === 'bar')
  const usesRightAxis = resolved.some((item) => item.axis === 'right')
  // A stack rounds only its top segment.
  const lastInStack = new Map<string, string>()
  for (const item of resolved) if (item.type === 'bar' && item.stackId) lastInStack.set(item.stackId, item.key)
  const axisFormat = (axis: 'left' | 'right'): ChartValueFormat =>
    (axis === 'right' ? rightAxis?.format : leftAxis?.format) ?? 'number'
  const labelFor = (value: unknown, row?: Row): string => {
    const text = value === undefined || value === null ? '' : String(value)
    if (formatTooltipLabel && row) return formatTooltipLabel(text, row)
    return formatX ? formatX(text) : text
  }
  const legendVisible = showLegend ?? resolved.length > 1
  const markSeries = markLastPoint ? resolved.find((item) => item.type !== 'bar') : undefined
  const lastRow = data.length > 0 ? data[data.length - 1] : undefined
  const lastRowValues = lastRow as Record<string, unknown> | undefined

  const valueAxis = (id: 'left' | 'right', options: ChartAxisOptions | undefined) => (
    <YAxis
      yAxisId={id}
      orientation={id}
      domain={options?.domain ?? [0, 'auto']}
      allowDecimals={options?.allowDecimals ?? true}
      tickFormatter={(value: number) => formatChartValue(value, axisFormat(id))}
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      width={options?.width ?? 'auto'}
    />
  )

  return (
    <ChartFrame
      height={height}
      heightClassName={heightClassName}
      ariaLabel={ariaLabel}
      className={className}
      clickable={Boolean(onPointClick)}
      legend={legendVisible ? (
        <ChartLegend items={resolved.map((item) => ({ key: item.key, label: item.label, color: item.color, kind: item.type, dashed: item.dashed }))} />
      ) : null}
    >
      <ComposedChart
        data={data}
        margin={CHART_MARGIN}
        barGap={barGap}
        barCategoryGap={barCategoryGap}
        onClick={onPointClick ? (state) => {
          const index = chartClickIndex(state, data.length)
          if (index !== null) onPointClick(index, data[index])
        } : undefined}
      >
        <defs>
          {resolved.filter((item) => item.type === 'area').map((item) => (
            <linearGradient key={item.key} id={`${gradientPrefix}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {showGrid && <CartesianGrid yAxisId="left" stroke={GRID_STROKE} strokeDasharray={GRID_DASH} vertical={false} />}
        <XAxis
          dataKey={xDataKey}
          interval={xInterval}
          minTickGap={xMinTickGap}
          tickFormatter={formatX ? (value: unknown) => formatX(String(value)) : undefined}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        {valueAxis('left', leftAxis)}
        {usesRightAxis && valueAxis('right', rightAxis)}
        {(referenceLines ?? []).map((line, index) => (
          <ReferenceLine
            key={`reference-${index}`}
            yAxisId={line.axis ?? 'left'}
            y={line.value}
            stroke={line.tone === 'danger' ? 'var(--color-danger)' : ZERO_LINE}
            strokeDasharray="5 5"
            strokeOpacity={0.6}
            label={line.label ? { value: line.label, position: 'insideTopRight', fontSize: 11, fill: 'var(--color-text-muted)' } : undefined}
          />
        ))}
        <RechartsTooltip
          cursor={hasBars ? BAR_CURSOR : LINE_CURSOR}
          content={({ active, payload, label }: TooltipContentProps) => {
            const row = payload?.find((entry) => entry.payload)?.payload as Row | undefined
            if (!active || !row) return null
            const values = row as Record<string, unknown>
            const items: ChartTooltipItem[] = resolved.flatMap((item) => {
              const value = values[item.key]
              if (typeof value !== 'number' || !Number.isFinite(value)) return []
              return [{
                key: item.key,
                label: item.label,
                value,
                formatted: formatChartValue(value, item.format ?? axisFormat(item.axis)),
                color: item.color,
                dashed: Boolean(item.dashed),
              }]
            })
            const title = labelFor(label ?? values[xKey], row)
            if (renderTooltip) {
              const body = renderTooltip({ label: title, row, items })
              return body === null || body === undefined || body === false ? null : <ChartTooltipFrame title={title}>{body}</ChartTooltipFrame>
            }
            if (items.length === 0) return null
            return (
              <ChartTooltipFrame title={title}>
                {items.map((item) => (
                  <ChartTooltipRow key={item.key} color={item.color} dashed={item.dashed} label={item.label} value={item.formatted} />
                ))}
              </ChartTooltipFrame>
            )
          }}
        />
        {resolved.map((item) => {
          if (item.type === 'bar') {
            const rounded = !item.stackId || lastInStack.get(item.stackId) === item.key
            return (
              <Bar
                key={item.key}
                yAxisId={item.axis}
                dataKey={item.key}
                name={item.label}
                fill={item.color}
                stackId={item.stackId}
                maxBarSize={maxBarSize}
                radius={rounded ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            )
          }
          if (item.type === 'area') {
            return (
              <Area
                key={item.key}
                yAxisId={item.axis}
                dataKey={item.key}
                name={item.label}
                type={item.curve ?? 'monotone'}
                stroke={item.color}
                strokeWidth={2}
                strokeDasharray={item.dashed ? '4 3' : undefined}
                fill={`url(#${gradientPrefix}-${item.key})`}
                dot={false}
                activeDot={{ r: 4, fill: item.color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            )
          }
          return (
            <Line
              key={item.key}
              yAxisId={item.axis}
              dataKey={item.key}
              name={item.label}
              type={item.curve ?? 'monotone'}
              stroke={item.color}
              strokeWidth={2}
              strokeDasharray={item.dashed ? '4 3' : undefined}
              dot={false}
              activeDot={{ r: 4, fill: item.color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )
        })}
        {markSeries && lastRowValues && typeof lastRowValues[markSeries.key] === 'number' && (
          <ReferenceDot
            yAxisId={markSeries.axis}
            x={lastRowValues[xKey] as string | number}
            y={lastRowValues[markSeries.key] as number}
            r={4}
            fill={markSeries.color}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  )
}

/**
 * Lines (or soft-filled areas) over a category or date axis: balances, running totals, hours
 * per person. Series default to `type: 'line'`; see `CartesianChartProps` for every prop.
 *
 * @example
 * <LineChart data={points} xKey="date" series={[{ key: 'balance', label: 'Balance', type: 'area' }]}
 *   leftAxis={{ format: 'shorthandCurrency', domain: ['auto', 'auto'] }} markLastPoint />
 */
export function LineChart<Row extends object>(props: LineChartProps<Row>) {
  return <CartesianChart {...props} defaultType="line" />
}

/**
 * Bars, lines and areas on one chart, with an optional right-hand axis: grouped bars (series
 * without a `stackId`), stacked bars (series sharing one), or bars with a trend line.
 * Series default to `type: 'bar'`; see `CartesianChartProps` for every prop.
 *
 * @example
 * <ComboChart data={months} xKey="monthLabel" leftAxis={{ format: 'currency' }}
 *   rightAxis={{ format: 'percent', domain: [0, 100] }}
 *   series={[
 *     { key: 'drinksSales', label: 'Drinks sales', color: 'var(--color-chart-2)' },
 *     { key: 'drinksPercentage', label: 'Drinks %', type: 'line', axis: 'right', color: 'var(--color-chart-2)' },
 *   ]} />
 */
export function ComboChart<Row extends object>(props: ComboChartProps<Row>) {
  return <CartesianChart {...props} defaultType="bar" />
}
