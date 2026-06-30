import { EXPENSE_METRIC_KEYS, PNL_TIMEFRAMES, type PnlMetricFormat, type PnlMetricGroup, type PnlTimeframeKey } from '@/lib/pnl/constants'
import type { PnlDashboardData } from '@/services/financials'

const TARGET_TIMEFRAME: PnlTimeframeKey = '12m'

const GROUP_ORDER: PnlMetricGroup[] = ['sales', 'sales_mix', 'sales_totals', 'expenses', 'occupancy']

const PNL_REPORT_GROUP_LABELS: Record<PnlMetricGroup, string> = {
  sales: 'Sales',
  sales_mix: 'Sales mix',
  sales_totals: 'Gross profit % targets',
  expenses: 'Expenses',
  occupancy: 'Rent/divisible balance assumptions',
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

type PnlReportSubtotal = {
  label: string
  format: PnlMetricFormat
  actual: number
  annualTarget: number | null
  timeframeTarget: number | null
  variance: number | null
  invertVariance?: boolean
}

type PnlReportSection = {
  key: PnlMetricGroup
  label: string
  rows: PnlReportRow[]
  subtotal?: PnlReportSubtotal
}

type PnlReportSummary = {
  revenueActual: number
  revenueTarget: number
  revenueVariance: number
  grossProfitActual: number
  grossProfitTarget: number
  grossProfitVariance: number
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
  dataQualityWarnings: string[]
  healthStatus: 'on_track' | 'watch' | 'off_track' | 'incomplete'
  healthLabel: string
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

function sumTargets(keys: string[], values: Record<string, number | null>): number {
  return roundCurrency(keys.reduce((sum, key) => sum + (values[key] ?? 0), 0))
}

function getPercent(
  actualValues: Record<string, number>,
  targetValues: Record<string, number | null>,
  key: string,
  warnings: string[],
  label: string
): number {
  const actual = actualValues[key]
  if (actual > 0) return actual
  const target = targetValues[key]
  if (target !== null && target > 0) {
    warnings.push(`${label} is using Greene King target GP % until an actual GP % is entered.`)
    return target
  }
  return 0
}

function benchmarkNumber(data: PnlDashboardData, metricKey: string, field: 'annualAmount' | 'grossProfit'): number | null {
  const row = data.greeneKingBenchmark?.rows.find((item) => item.metricKey === metricKey)
  const value = row?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function canUseBenchmarkGrossProfit(data: PnlDashboardData, annualTargetValues: Record<string, number | null>): boolean {
  const keys = ['drinks_sales', 'food_sales', 'accommodation_sales', 'net_machine_income']
  return keys.every((key) => {
    const benchmarkValue = benchmarkNumber(data, key, 'annualAmount')
    return benchmarkValue !== null && annualTargetValues[key] === benchmarkValue
  })
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
  const dataQualityWarnings = [...(data.dataQuality?.warnings ?? [])]

  for (const metric of data.metrics) {
    annualTargetValues[metric.key] = toFiniteNumber(data.targets[metric.key]?.[TARGET_TIMEFRAME] ?? null)
    const targetFormat: PnlMetricFormat = metric.type === 'expense' ? 'currency' : (metric.format ?? 'currency')
    timeframeTargetValues[metric.key] = deriveTargetValue(targetFormat, timeframe, annualTargetValues[metric.key])
    const rawActual = toFiniteNumber(data.actuals[timeframe]?.[metric.key] ?? null) ?? 0
    actualValues[metric.key] = metric.group === 'sales_totals' && rawActual === 0 && timeframeTargetValues[metric.key]
      ? timeframeTargetValues[metric.key] ?? 0
      : rawActual
  }

  const cashupSales = data.cashupSales?.[timeframe]
  if (cashupSales) {
    actualValues.drinks_sales = cashupSales.drinksSales
    actualValues.food_sales = cashupSales.foodPlusOtherSales
  }
  const cashupRevenueActual = cashupSales?.totalRevenue ?? (
    (actualValues.drinks_sales ?? 0) +
    (actualValues.food_sales ?? 0) +
    (actualValues.accommodation_sales ?? 0)
  )

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

  const salesActual = roundCurrency(cashupRevenueActual + (actualValues.net_machine_income ?? 0))

  const salesTarget = sumTargets(['drinks_sales', 'food_sales', 'accommodation_sales', 'net_machine_income'], timeframeTargetValues)
  const salesAnnualTarget = roundCurrency(
    ['drinks_sales', 'food_sales', 'accommodation_sales', 'net_machine_income']
      .reduce((sum, key) => sum + (annualTargetValues[key] ?? 0), 0)
  )

  const automaticExpenseTarget = EXPENSE_METRIC_KEYS
    .reduce((sum, key) => sum + (timeframeTargetValues[key] ?? 0), 0)
  const automaticExpenseAnnualTarget = data.metrics
    .filter((metric) => metric.type === 'expense')
    .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)

  const drinksGpActualPercent = getPercent(actualValues, timeframeTargetValues, 'total_drinks_post_wastage', dataQualityWarnings, 'Drinks GP')
  const foodGpActualPercent = getPercent(actualValues, timeframeTargetValues, 'total_food', dataQualityWarnings, 'Food + other GP')
  const accommodationGpActualPercent = getPercent(actualValues, timeframeTargetValues, 'total_accommodation', dataQualityWarnings, 'Accommodation GP')
  const grossProfitActual = roundCurrency(
    ((actualValues.drinks_sales ?? 0) * (drinksGpActualPercent / 100)) +
    ((actualValues.food_sales ?? 0) * (foodGpActualPercent / 100)) +
    ((actualValues.accommodation_sales ?? 0) * (accommodationGpActualPercent / 100)) +
    (actualValues.net_machine_income ?? 0)
  )
  const benchmarkGrossProfit = canUseBenchmarkGrossProfit(data, annualTargetValues)
    ? benchmarkNumber(data, 'total_income', 'grossProfit')
    : null
  const grossProfitAnnualTarget = benchmarkGrossProfit ?? roundCurrency(
    ((annualTargetValues.drinks_sales ?? 0) * ((annualTargetValues.total_drinks_post_wastage ?? 0) / 100)) +
    ((annualTargetValues.food_sales ?? 0) * ((annualTargetValues.total_food ?? 0) / 100)) +
    ((annualTargetValues.accommodation_sales ?? 0) * ((annualTargetValues.total_accommodation ?? 0) / 100)) +
    (annualTargetValues.net_machine_income ?? 0)
  )
  const timeframeConfig = PNL_TIMEFRAMES.find((item) => item.key === timeframe)
  const annualConfig = PNL_TIMEFRAMES.find((item) => item.key === TARGET_TIMEFRAME)
  const grossProfitTarget = benchmarkGrossProfit !== null && timeframeConfig && annualConfig
    ? roundCurrency(benchmarkGrossProfit * (timeframeConfig.days / annualConfig.days))
    : roundCurrency(
      ((timeframeTargetValues.drinks_sales ?? 0) * ((timeframeTargetValues.total_drinks_post_wastage ?? 0) / 100)) +
      ((timeframeTargetValues.food_sales ?? 0) * ((timeframeTargetValues.total_food ?? 0) / 100)) +
      ((timeframeTargetValues.accommodation_sales ?? 0) * ((timeframeTargetValues.total_accommodation ?? 0) / 100)) +
      (timeframeTargetValues.net_machine_income ?? 0)
    )

  const expenseActual = roundCurrency(data.expenseTotals[timeframe] ?? 0)
  const expenseTarget = roundCurrency(automaticExpenseTarget)
  const expenseAnnualTarget = roundCurrency(automaticExpenseAnnualTarget)

  const operatingProfitActual = roundCurrency(grossProfitActual - expenseActual)
  const operatingProfitTarget = roundCurrency(grossProfitTarget - expenseTarget)
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

    if (section.key === 'sales_totals') {
      return {
        ...section,
        subtotal: {
          label: 'Gross profit / income',
          format: 'currency',
          actual: grossProfitActual,
          annualTarget: grossProfitAnnualTarget,
          timeframeTarget: grossProfitTarget,
          variance: roundCurrency(grossProfitActual - grossProfitTarget),
        },
      }
    }

    if (section.key === 'expenses') {
      return {
        ...section,
        subtotal: {
          label: 'Total expenses',
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
  const operatingProfitVariance = roundCurrency(operatingProfitActual - operatingProfitTarget)
  const targetBase = Math.max(Math.abs(operatingProfitTarget), 1)
  const hasCriticalDataGap = dataQualityWarnings.some((warning) =>
    warning.includes('could not be loaded') || warning.includes('No completed cash-up sessions')
  )
  const healthStatus = hasCriticalDataGap
    ? 'incomplete'
    : operatingProfitVariance >= 0
      ? 'on_track'
      : Math.abs(operatingProfitVariance) / targetBase <= 0.05
        ? 'watch'
        : 'off_track'
  const healthLabel = healthStatus === 'on_track'
    ? 'On track'
    : healthStatus === 'watch'
      ? 'Watch closely'
      : healthStatus === 'off_track'
        ? 'Needs attention'
        : 'Data incomplete'

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
      grossProfitActual,
      grossProfitTarget,
      grossProfitVariance: roundCurrency(grossProfitActual - grossProfitTarget),
      expenseActual,
      expenseTarget,
      expenseVariance: roundCurrency(expenseActual - expenseTarget),
      operatingProfitActual,
      operatingProfitTarget,
      operatingProfitVariance,
    },
    dataQualityWarnings: Array.from(new Set(dataQualityWarnings)),
    healthStatus,
    healthLabel,
  }
}
