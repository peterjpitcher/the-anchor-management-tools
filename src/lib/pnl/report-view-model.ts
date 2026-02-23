import { PNL_TIMEFRAMES, type PnlMetricFormat, type PnlMetricGroup, type PnlTimeframeKey } from '@/lib/pnl/constants'
import type { PnlDashboardData } from '@/services/financials'

const TARGET_TIMEFRAME: PnlTimeframeKey = '12m'

const GROUP_ORDER: PnlMetricGroup[] = ['sales', 'sales_mix', 'sales_totals', 'expenses', 'occupancy']

export const PNL_REPORT_GROUP_LABELS: Record<PnlMetricGroup, string> = {
  sales: 'Sales',
  sales_mix: 'Sales mix',
  sales_totals: 'Gross profit % targets',
  expenses: 'Expenses',
  occupancy: 'Occupancy costs',
}

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PERCENT_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export type PnlReportRow = {
  key: string
  label: string
  group: PnlMetricGroup
  format: PnlMetricFormat
  actual: number
  annualTarget: number | null
  timeframeTarget: number | null
  variance: number | null
  detailLines: string[]
}

export type PnlReportSubtotal = {
  label: string
  format: PnlMetricFormat
  actual: number
  annualTarget: number | null
  timeframeTarget: number | null
  variance: number | null
  invertVariance?: boolean
}

export type PnlReportSection = {
  key: PnlMetricGroup
  label: string
  rows: PnlReportRow[]
  subtotal?: PnlReportSubtotal
}

export type PnlReportSummary = {
  revenueActual: number
  revenueTarget: number
  revenueVariance: number
  expenseActual: number
  expenseTarget: number
  expenseVariance: number
  operatingProfitActual: number
  operatingProfitTarget: number
  operatingProfitVariance: number
}

export type PnlReportViewModel = {
  timeframe: PnlTimeframeKey
  timeframeLabel: string
  generatedAtIso: string
  generatedAtLabel: string
  sections: PnlReportSection[]
  summary: PnlReportSummary
}

function toFiniteNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }
  return value
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function deriveTargetValue(
  format: PnlMetricFormat,
  timeframe: PnlTimeframeKey,
  annualTarget: number | null
): number | null {
  if (annualTarget === null) return null
  if (format === 'percent') return annualTarget

  const timeframeConfig = PNL_TIMEFRAMES.find((item) => item.key === timeframe)
  const annualConfig = PNL_TIMEFRAMES.find((item) => item.key === TARGET_TIMEFRAME)

  if (!timeframeConfig || !annualConfig) {
    return annualTarget
  }

  const ratio = timeframeConfig.days / annualConfig.days
  return roundCurrency(annualTarget * ratio)
}

function variance(actual: number, target: number | null): number | null {
  if (target === null) return null
  return roundCurrency(actual - target)
}

export function formatPnlMetricValue(value: number | null, format: PnlMetricFormat = 'currency'): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (format === 'percent') {
    return PERCENT_FORMATTER.format(value / 100)
  }
  return CURRENCY_FORMATTER.format(value)
}

export function buildPnlReportViewModel(
  data: PnlDashboardData,
  timeframe: PnlTimeframeKey,
  generatedAt = new Date()
): PnlReportViewModel {
  const annualTargetValues: Record<string, number | null> = {}
  const actualValues: Record<string, number> = {}
  const timeframeTargetValues: Record<string, number | null> = {}

  for (const metric of data.metrics) {
    annualTargetValues[metric.key] = toFiniteNumber(data.targets[metric.key]?.[TARGET_TIMEFRAME] ?? null)
    actualValues[metric.key] = toFiniteNumber(data.actuals[timeframe]?.[metric.key] ?? null) ?? 0

    const targetFormat: PnlMetricFormat = metric.type === 'expense' ? 'currency' : (metric.format ?? 'currency')
    timeframeTargetValues[metric.key] = deriveTargetValue(targetFormat, timeframe, annualTargetValues[metric.key])
  }

  const sections: PnlReportSection[] = GROUP_ORDER.map((group) => {
    const rows = data.metrics
      .filter((metric) => metric.group === group)
      .map<PnlReportRow>((metric) => {
        const format: PnlMetricFormat = metric.type === 'expense' ? 'currency' : (metric.format ?? 'currency')
        const actual = actualValues[metric.key] ?? 0
        const annualTarget = annualTargetValues[metric.key] ?? null
        const timeframeTarget = timeframeTargetValues[metric.key] ?? null
        const detailLines: string[] = []

        if (metric.baseMetricKey) {
          const baseActual = actualValues[metric.baseMetricKey] ?? 0
          const baseTarget = timeframeTargetValues[metric.baseMetricKey] ?? null

          if (metric.group === 'sales_mix') {
            const actualCurrency = roundCurrency(baseActual * (actual / 100))
            const targetCurrency = baseTarget !== null && timeframeTarget !== null
              ? roundCurrency(baseTarget * (timeframeTarget / 100))
              : null

            detailLines.push(`Actual ${formatPnlMetricValue(actualCurrency, 'currency')}`)
            if (targetCurrency !== null) {
              detailLines.push(`P&L Target ${formatPnlMetricValue(targetCurrency, 'currency')}`)
            }
          }

          if (metric.group === 'sales_totals') {
            const gpActual = roundCurrency(baseActual * (actual / 100))
            const costActual = roundCurrency(baseActual - gpActual)
            const gpTarget = baseTarget !== null && timeframeTarget !== null
              ? roundCurrency(baseTarget * (timeframeTarget / 100))
              : null
            const costTarget = gpTarget !== null && baseTarget !== null
              ? roundCurrency(baseTarget - gpTarget)
              : null

            detailLines.push(
              `Actual GP ${formatPnlMetricValue(gpActual, 'currency')} · Cost ${formatPnlMetricValue(costActual, 'currency')}`
            )

            if (gpTarget !== null && costTarget !== null) {
              detailLines.push(
                `P&L Target GP ${formatPnlMetricValue(gpTarget, 'currency')} · Cost ${formatPnlMetricValue(costTarget, 'currency')}`
              )
            }
          }
        }

        return {
          key: metric.key,
          label: metric.label,
          group: metric.group,
          format,
          actual,
          annualTarget,
          timeframeTarget,
          variance: variance(actual, timeframeTarget),
          detailLines,
        }
      })

    return {
      key: group,
      label: PNL_REPORT_GROUP_LABELS[group],
      rows,
    }
  })

  const salesActual = roundCurrency(
    data.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (actualValues[metric.key] ?? 0), 0)
  )

  const salesTarget = roundCurrency(
    data.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (timeframeTargetValues[metric.key] ?? 0), 0)
  )
  const salesAnnualTarget = roundCurrency(
    data.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)
  )

  const occupancyActual = data.metrics
    .filter((metric) => metric.group === 'occupancy')
    .reduce((sum, metric) => sum + (actualValues[metric.key] ?? 0), 0)

  const occupancyTarget = data.metrics
    .filter((metric) => metric.group === 'occupancy')
    .reduce((sum, metric) => sum + (timeframeTargetValues[metric.key] ?? 0), 0)
  const occupancyAnnualTarget = data.metrics
    .filter((metric) => metric.group === 'occupancy')
    .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)

  const automaticExpenseTarget = data.metrics
    .filter((metric) => metric.type === 'expense')
    .reduce((sum, metric) => sum + (timeframeTargetValues[metric.key] ?? 0), 0)
  const automaticExpenseAnnualTarget = data.metrics
    .filter((metric) => metric.type === 'expense')
    .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)

  const expenseActual = roundCurrency((data.expenseTotals[timeframe] ?? 0) + occupancyActual)
  const expenseTarget = roundCurrency(automaticExpenseTarget + occupancyTarget)
  const expenseAnnualTarget = roundCurrency(automaticExpenseAnnualTarget + occupancyAnnualTarget)

  const operatingProfitActual = roundCurrency(salesActual - expenseActual)
  const operatingProfitTarget = roundCurrency(salesTarget - expenseTarget)
  const sectionsWithSubtotals = sections.map<PnlReportSection>((section) => {
    if (section.key === 'sales') {
      return {
        ...section,
        subtotal: {
          label: 'Total sales',
          format: 'currency',
          actual: salesActual,
          annualTarget: salesAnnualTarget,
          timeframeTarget: salesTarget,
          variance: roundCurrency(salesActual - salesTarget),
        },
      }
    }

    if (section.key === 'expenses') {
      return {
        ...section,
        subtotal: {
          label: 'Total expenses (incl occupancy)',
          format: 'currency',
          actual: expenseActual,
          annualTarget: expenseAnnualTarget,
          timeframeTarget: expenseTarget,
          variance: roundCurrency(expenseActual - expenseTarget),
          invertVariance: true,
        },
      }
    }

    return section
  })

  const timeframeLabel = PNL_TIMEFRAMES.find((item) => item.key === timeframe)?.label ?? timeframe

  return {
    timeframe,
    timeframeLabel,
    generatedAtIso: generatedAt.toISOString(),
    generatedAtLabel: `${generatedAt.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    })} UTC`,
    sections: sectionsWithSubtotals,
    summary: {
      revenueActual: salesActual,
      revenueTarget: salesTarget,
      revenueVariance: roundCurrency(salesActual - salesTarget),
      expenseActual,
      expenseTarget,
      expenseVariance: roundCurrency(expenseActual - expenseTarget),
      operatingProfitActual,
      operatingProfitTarget,
      operatingProfitVariance: roundCurrency(operatingProfitActual - operatingProfitTarget),
    },
  }
}
