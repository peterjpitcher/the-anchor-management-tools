import type {
  ReceiptVendorAiReview,
  ReceiptVendorCostSignal,
  ReceiptVendorMovementComparison,
  ReceiptVendorMovementMonth,
  ReceiptVendorMovementRange,
  ReceiptVendorMovementSignal,
  ReceiptVendorMovementSummary,
  ReceiptVendorSummary,
  ReceiptVendorTrendMonth,
} from './types'

const DEFAULT_MONTH_WINDOW = 12
const MAX_MONTH_WINDOW = 24
const REVIEW_PERCENT_THRESHOLD = 25
const REVIEW_ABSOLUTE_THRESHOLD = 100
const HIGH_PERCENT_THRESHOLD = 50
const HIGH_ABSOLUTE_THRESHOLD = 250
const NEW_VENDOR_THRESHOLD = 100
const DEFAULT_MOVEMENT_RANGE: ReceiptVendorMovementRange = '36m'
const DEFAULT_MOVEMENT_COMPARISON: ReceiptVendorMovementComparison = 'yoy'

type ReceiptVendorMovementSource = {
  vendorLabel: string
  months: ReceiptVendorTrendMonth[]
}

export function normalizeReceiptVendorKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.toLowerCase() : null
}

export function normalizeReceiptMonthWindow(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_MONTH_WINDOW
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_MONTH_WINDOW)
}

export function normalizeReceiptVendorMovementRange(value: unknown): ReceiptVendorMovementRange {
  return value === '12m' || value === '24m' || value === '36m' || value === 'all'
    ? value
    : DEFAULT_MOVEMENT_RANGE
}

export function normalizeReceiptVendorMovementComparison(value: unknown): ReceiptVendorMovementComparison {
  return value === 'mom' || value === 'yoy' || value === 'rolling_3m'
    ? value
    : DEFAULT_MOVEMENT_COMPARISON
}

export function receiptVendorMovementRangeMonths(range: ReceiptVendorMovementRange): number | null {
  if (range === '12m') return 12
  if (range === '24m') return 24
  if (range === '36m') return 36
  return null
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMonthLabel(monthStart: string): string {
  return new Date(monthStart).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function toMonthStart(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

function addUtcMonths(monthStart: string, offset: number): string {
  const date = new Date(monthStart)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10)
}

function buildMonthKeys(monthWindow: number, referenceMonthStart: string): string[] {
  const start = addUtcMonths(referenceMonthStart, -(monthWindow - 1))
  return Array.from({ length: monthWindow }, (_, index) => addUtcMonths(start, index))
}

function buildMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = []
  let current = startMonth

  while (current <= endMonth) {
    months.push(current)
    current = addUtcMonths(current, 1)
  }

  return months
}

function averageOutgoing(months: ReceiptVendorTrendMonth[]): number {
  if (!months.length) return 0
  return months.reduce((sum, month) => sum + month.totalOutgoing, 0) / months.length
}

function resolveReferenceMonthStart(vendors: ReceiptVendorSummary[], fallbackDate: Date): string {
  const latestMonth = vendors.reduce<string | null>((latest, vendor) => {
    for (const month of vendor.months) {
      const monthStart = toMonthStart(month.monthStart)
      if (monthStart && (!latest || monthStart > latest)) {
        latest = monthStart
      }
    }
    return latest
  }, null)

  return latestMonth ?? toMonthStart(fallbackDate) ?? new Date().toISOString().slice(0, 10)
}

function fillReceiptVendorMonthWindow(
  months: ReceiptVendorTrendMonth[],
  options: { monthWindow?: number; referenceMonthStart?: string | Date } = {},
): ReceiptVendorTrendMonth[] {
  const monthWindow = normalizeReceiptMonthWindow(options.monthWindow)
  const referenceMonthStart =
    (options.referenceMonthStart ? toMonthStart(options.referenceMonthStart) : null) ??
    toMonthStart(new Date())!
  const monthMap = new Map<string, ReceiptVendorTrendMonth>()

  months.forEach((month) => {
    const key = toMonthStart(month.monthStart)
    if (!key) return
    monthMap.set(key, {
      monthStart: key,
      totalOutgoing: Number(month.totalOutgoing ?? 0),
      totalIncome: Number(month.totalIncome ?? 0),
      transactionCount: Number(month.transactionCount ?? 0),
    })
  })

  return buildMonthKeys(monthWindow, referenceMonthStart).map((monthStart) => {
    const existing = monthMap.get(monthStart)
    return existing ?? {
      monthStart,
      totalOutgoing: 0,
      totalIncome: 0,
      transactionCount: 0,
    }
  })
}

export function calculateReceiptVendorTrendStats(
  months: ReceiptVendorTrendMonth[],
  options: { monthWindow?: number; referenceMonthStart?: string | Date } = {},
) {
  const filledMonths = fillReceiptVendorMonthWindow(months, options)
  const recent = filledMonths.slice(-3)
  const previous = filledMonths.slice(-6, -3)
  const recentAverageOutgoing = averageOutgoing(recent)
  const previousAverageOutgoing = averageOutgoing(previous)
  const absoluteDelta = recentAverageOutgoing - previousAverageOutgoing
  const percentageChange = previousAverageOutgoing === 0
    ? (recentAverageOutgoing > 0 ? 100 : 0)
    : (absoluteDelta / previousAverageOutgoing) * 100

  return {
    filledMonths,
    recentAverageOutgoing: Number(recentAverageOutgoing.toFixed(2)),
    previousAverageOutgoing: Number(previousAverageOutgoing.toFixed(2)),
    recentTotalOutgoing: Number(recent.reduce((sum, month) => sum + month.totalOutgoing, 0).toFixed(2)),
    previousTotalOutgoing: Number(previous.reduce((sum, month) => sum + month.totalOutgoing, 0).toFixed(2)),
    absoluteDelta: Number(absoluteDelta.toFixed(2)),
    percentageChange: Number(percentageChange.toFixed(2)),
  }
}

export function buildReceiptVendorCostSignals(
  vendors: ReceiptVendorSummary[],
  options: { monthWindow?: number; referenceMonthStart?: string | Date; referenceDate?: Date } = {},
): ReceiptVendorCostSignal[] {
  const monthWindow = normalizeReceiptMonthWindow(options.monthWindow)
  const referenceMonthStart =
    (options.referenceMonthStart ? toMonthStart(options.referenceMonthStart) : null) ??
    resolveReferenceMonthStart(vendors, options.referenceDate ?? new Date())

  return vendors
    .map((vendor): ReceiptVendorCostSignal | null => {
      const stats = calculateReceiptVendorTrendStats(vendor.months, {
        monthWindow,
        referenceMonthStart,
      })
      const absDelta = Math.abs(stats.absoluteDelta)
      const absPercentage = Math.abs(stats.percentageChange)

      let direction: ReceiptVendorCostSignal['direction'] | null = null

      if (
        stats.previousAverageOutgoing === 0 &&
        stats.recentAverageOutgoing >= NEW_VENDOR_THRESHOLD
      ) {
        direction = 'new'
      } else if (
        absPercentage >= REVIEW_PERCENT_THRESHOLD &&
        absDelta >= REVIEW_ABSOLUTE_THRESHOLD
      ) {
        direction = stats.absoluteDelta > 0 ? 'spike' : 'drop'
      }

      if (!direction) return null

      const severity: ReceiptVendorCostSignal['severity'] =
        absPercentage >= HIGH_PERCENT_THRESHOLD || absDelta >= HIGH_ABSOLUTE_THRESHOLD
          ? 'high'
          : 'medium'

      const recent = formatCurrency(stats.recentAverageOutgoing)
      const previous = formatCurrency(stats.previousAverageOutgoing)
      const percent = `${stats.percentageChange > 0 ? '+' : ''}${stats.percentageChange.toFixed(1)}%`
      const reason = direction === 'new'
        ? `${vendor.vendorLabel} has started appearing at ${recent} average monthly spend.`
        : `${vendor.vendorLabel} moved from ${previous} to ${recent} average monthly spend (${percent}).`

      return {
        vendorLabel: vendor.vendorLabel,
        severity,
        direction,
        recentAverageOutgoing: stats.recentAverageOutgoing,
        previousAverageOutgoing: stats.previousAverageOutgoing,
        recentTotalOutgoing: stats.recentTotalOutgoing,
        previousTotalOutgoing: stats.previousTotalOutgoing,
        absoluteDelta: Math.abs(stats.absoluteDelta),
        percentageChange: stats.percentageChange,
        reason,
      }
    })
    .filter((signal): signal is ReceiptVendorCostSignal => Boolean(signal))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
      return b.absoluteDelta - a.absoluteDelta
    })
}

function latestMovementMonth(vendors: ReceiptVendorMovementSource[]): string | null {
  return vendors.reduce<string | null>((latest, vendor) => {
    for (const month of vendor.months) {
      const monthStart = toMonthStart(month.monthStart)
      if (monthStart && (!latest || monthStart > latest)) {
        latest = monthStart
      }
    }
    return latest
  }, null)
}

function earliestMovementMonth(vendors: ReceiptVendorMovementSource[]): string | null {
  return vendors.reduce<string | null>((earliest, vendor) => {
    for (const month of vendor.months) {
      const monthStart = toMonthStart(month.monthStart)
      if (monthStart && (!earliest || monthStart < earliest)) {
        earliest = monthStart
      }
    }
    return earliest
  }, null)
}

function monthMapForMovement(months: ReceiptVendorTrendMonth[]): Map<string, ReceiptVendorTrendMonth> {
  const monthMap = new Map<string, ReceiptVendorTrendMonth>()

  months.forEach((month) => {
    const monthStart = toMonthStart(month.monthStart)
    if (!monthStart) return
    const existing = monthMap.get(monthStart) ?? {
      monthStart,
      totalOutgoing: 0,
      totalIncome: 0,
      transactionCount: 0,
    }
    existing.totalOutgoing += Number(month.totalOutgoing ?? 0)
    existing.totalIncome += Number(month.totalIncome ?? 0)
    existing.transactionCount += Number(month.transactionCount ?? 0)
    monthMap.set(monthStart, existing)
  })

  return monthMap
}

function roundMovementValue(value: number): number {
  return Number(value.toFixed(2))
}

function movementPercentage(current: number, baseline: number): number {
  if (baseline === 0) return current > 0 ? 100 : 0
  return ((current - baseline) / baseline) * 100
}

function hasPriorSpendBefore(monthMap: Map<string, ReceiptVendorTrendMonth>, monthStart: string): boolean {
  for (const [key, month] of monthMap) {
    if (key < monthStart && Number(month.totalOutgoing ?? 0) > 0) {
      return true
    }
  }
  return false
}

function comparisonLabel(comparison: ReceiptVendorMovementComparison): string {
  if (comparison === 'mom') return 'MoM'
  if (comparison === 'rolling_3m') return 'rolling three-month'
  return 'YoY'
}

function buildMovementSignal(input: {
  vendorLabel: string
  comparison: ReceiptVendorMovementComparison
  monthStart: string
  currentOutgoing: number
  baselineOutgoing: number
  baselineMonthStart: string | null
  hadPriorSpendBeforeCurrent: boolean
}): ReceiptVendorMovementSignal | null {
  const delta = roundMovementValue(input.currentOutgoing - input.baselineOutgoing)
  const absoluteDelta = Math.abs(delta)
  const percentageChange = roundMovementValue(movementPercentage(input.currentOutgoing, input.baselineOutgoing))
  const absolutePercentage = Math.abs(percentageChange)

  let direction: ReceiptVendorMovementSignal['direction'] | null = null

  if (input.baselineOutgoing === 0 && input.currentOutgoing >= NEW_VENDOR_THRESHOLD) {
    direction = input.hadPriorSpendBeforeCurrent ? 'resumed' : 'new'
  } else if (
    absoluteDelta >= REVIEW_ABSOLUTE_THRESHOLD &&
    absolutePercentage >= REVIEW_PERCENT_THRESHOLD
  ) {
    direction = delta > 0 ? 'spike' : 'drop'
  }

  if (!direction) return null

  const severity: ReceiptVendorMovementSignal['severity'] =
    absoluteDelta >= HIGH_ABSOLUTE_THRESHOLD || absolutePercentage >= HIGH_PERCENT_THRESHOLD
      ? 'high'
      : 'medium'

  const comparisonText = comparisonLabel(input.comparison)
  const monthText = formatMonthLabel(input.monthStart)
  const baselineText = input.baselineMonthStart ? formatMonthLabel(input.baselineMonthStart) : 'baseline'
  const percent = `${percentageChange > 0 ? '+' : ''}${percentageChange.toFixed(1)}%`
  const reason = direction === 'new'
    ? `${input.vendorLabel} is new at ${formatCurrency(input.currentOutgoing)} in ${monthText} with no ${comparisonText} baseline spend.`
    : direction === 'resumed'
      ? `${input.vendorLabel} resumed at ${formatCurrency(input.currentOutgoing)} in ${monthText} after a zero ${comparisonText} baseline.`
      : `${input.vendorLabel} ${delta > 0 ? 'increased' : 'decreased'} ${comparisonText} from ${formatCurrency(input.baselineOutgoing)} in ${baselineText} to ${formatCurrency(input.currentOutgoing)} in ${monthText} (${percent}).`

  return {
    vendorLabel: input.vendorLabel,
    severity,
    direction,
    comparison: input.comparison,
    monthStart: input.monthStart,
    currentOutgoing: roundMovementValue(input.currentOutgoing),
    baselineOutgoing: roundMovementValue(input.baselineOutgoing),
    baselineMonthStart: input.baselineMonthStart,
    absoluteDelta: roundMovementValue(absoluteDelta),
    percentageChange,
    reason,
  }
}

function buildReceiptVendorMovementMonths(
  vendor: ReceiptVendorMovementSource,
  options: {
    displayStartMonth: string
    latestMonth: string
    analysisStartMonth: string
  },
): ReceiptVendorMovementMonth[] {
  const monthMap = monthMapForMovement(vendor.months)

  return buildMonthRange(options.displayStartMonth, options.latestMonth).map((monthStart) => {
    const month = monthMap.get(monthStart) ?? {
      monthStart,
      totalOutgoing: 0,
      totalIncome: 0,
      transactionCount: 0,
    }
    const momBaselineMonthStart = addUtcMonths(monthStart, -1)
    const yoyBaselineMonthStart = addUtcMonths(monthStart, -12)
    const momBaselineAvailable = momBaselineMonthStart >= options.analysisStartMonth
    const yoyBaselineAvailable = yoyBaselineMonthStart >= options.analysisStartMonth
    const momBaseline = momBaselineAvailable
      ? (monthMap.get(momBaselineMonthStart)?.totalOutgoing ?? 0)
      : null
    const yoyBaseline = yoyBaselineAvailable
      ? (monthMap.get(yoyBaselineMonthStart)?.totalOutgoing ?? 0)
      : null
    const totalOutgoing = roundMovementValue(Number(month.totalOutgoing ?? 0))
    const totalIncome = roundMovementValue(Number(month.totalIncome ?? 0))
    const momDelta = momBaseline === null ? null : roundMovementValue(totalOutgoing - momBaseline)
    const yoyDelta = yoyBaseline === null ? null : roundMovementValue(totalOutgoing - yoyBaseline)
    const momPercentageChange = momBaseline === null ? null : roundMovementValue(movementPercentage(totalOutgoing, momBaseline))
    const yoyPercentageChange = yoyBaseline === null ? null : roundMovementValue(movementPercentage(totalOutgoing, yoyBaseline))

    return {
      monthStart,
      totalOutgoing,
      totalIncome,
      transactionCount: Number(month.transactionCount ?? 0),
      momBaselineMonthStart: momBaselineAvailable ? momBaselineMonthStart : null,
      momBaselineOutgoing: momBaseline === null ? null : roundMovementValue(momBaseline),
      momDelta,
      momPercentageChange,
      momBaselineAvailable,
      momSignal: momBaseline === null
        ? null
        : buildMovementSignal({
          vendorLabel: vendor.vendorLabel,
          comparison: 'mom',
          monthStart,
          currentOutgoing: totalOutgoing,
          baselineOutgoing: momBaseline,
          baselineMonthStart: momBaselineMonthStart,
          hadPriorSpendBeforeCurrent: hasPriorSpendBefore(monthMap, monthStart),
        }),
      yoyBaselineMonthStart: yoyBaselineAvailable ? yoyBaselineMonthStart : null,
      yoyBaselineOutgoing: yoyBaseline === null ? null : roundMovementValue(yoyBaseline),
      yoyDelta,
      yoyPercentageChange,
      yoyBaselineAvailable,
      yoySignal: yoyBaseline === null
        ? null
        : buildMovementSignal({
          vendorLabel: vendor.vendorLabel,
          comparison: 'yoy',
          monthStart,
          currentOutgoing: totalOutgoing,
          baselineOutgoing: yoyBaseline,
          baselineMonthStart: yoyBaselineMonthStart,
          hadPriorSpendBeforeCurrent: hasPriorSpendBefore(monthMap, monthStart),
        }),
    }
  })
}

export function buildReceiptVendorMovementMonthsForVendor(
  vendorLabel: string,
  months: ReceiptVendorTrendMonth[],
  options: { range?: ReceiptVendorMovementRange; referenceMonthStart?: string | Date } = {},
): ReceiptVendorMovementMonth[] {
  const range = normalizeReceiptVendorMovementRange(options.range ?? 'all')
  const latestMonth =
    (options.referenceMonthStart ? toMonthStart(options.referenceMonthStart) : null) ??
    latestMovementMonth([{ vendorLabel, months }])
  const earliestMonth = earliestMovementMonth([{ vendorLabel, months }])

  if (!latestMonth || !earliestMonth) {
    return []
  }

  const rangeMonths = receiptVendorMovementRangeMonths(range)
  const displayStartMonth = rangeMonths
    ? addUtcMonths(latestMonth, -(rangeMonths - 1))
    : earliestMonth

  return buildReceiptVendorMovementMonths({ vendorLabel, months }, {
    displayStartMonth,
    latestMonth,
    analysisStartMonth: earliestMonth,
  })
}

export function buildReceiptVendorMovementSummaries(
  vendors: ReceiptVendorMovementSource[],
  options: {
    range?: ReceiptVendorMovementRange
    comparison?: ReceiptVendorMovementComparison
    referenceMonthStart?: string | Date
  } = {},
): ReceiptVendorMovementSummary[] {
  const range = normalizeReceiptVendorMovementRange(options.range)
  const comparison = normalizeReceiptVendorMovementComparison(options.comparison)
  const latestDataMonth = latestMovementMonth(vendors)
  const completedMonthCutoff = addUtcMonths(toMonthStart(new Date())!, -1)
  const latestMonth = options.referenceMonthStart
    ? toMonthStart(options.referenceMonthStart)
    : latestDataMonth && latestDataMonth < completedMonthCutoff
      ? latestDataMonth
      : completedMonthCutoff
  const earliestMonth = earliestMovementMonth(vendors)

  if (!latestMonth || !earliestMonth) {
    return []
  }

  const rangeMonths = receiptVendorMovementRangeMonths(range)
  const displayStartMonth = rangeMonths
    ? addUtcMonths(latestMonth, -(rangeMonths - 1))
    : earliestMonth
  const analysisStartMonth = earliestMonth

  return vendors
    .filter((vendor) => vendor.vendorLabel !== 'Uncategorised')
    .map((vendor): ReceiptVendorMovementSummary | null => {
      const months = buildReceiptVendorMovementMonths(vendor, {
        displayStartMonth,
        latestMonth,
        analysisStartMonth,
      })
      const latest = months[months.length - 1] ?? null
      let latestOutgoing = latest?.totalOutgoing ?? 0
      let latestTransactionCount = latest?.transactionCount ?? 0
      let baselineOutgoing = latest
        ? (comparison === 'mom' ? latest.momBaselineOutgoing : latest.yoyBaselineOutgoing)
        : null
      let baselineMonthStart = latest
        ? (comparison === 'mom' ? latest.momBaselineMonthStart : latest.yoyBaselineMonthStart)
        : null
      let delta = latest
        ? (comparison === 'mom' ? latest.momDelta : latest.yoyDelta)
        : null
      let percentageChange = latest
        ? (comparison === 'mom' ? latest.momPercentageChange : latest.yoyPercentageChange)
        : null
      let signal = latest
        ? (comparison === 'mom' ? latest.momSignal : latest.yoySignal)
        : null

      if (comparison === 'rolling_3m' && latest) {
        const recentMonths = months.slice(-3)
        const previousMonths = months.slice(-6, -3)
        const hasBaseline = previousMonths.length === 3 && addUtcMonths(latest.monthStart, -5) >= analysisStartMonth
        const average = (items: ReceiptVendorMovementMonth[]) =>
          items.reduce((sum, month) => sum + month.totalOutgoing, 0) / Math.max(items.length, 1)

        latestOutgoing = roundMovementValue(average(recentMonths))
        latestTransactionCount = recentMonths.reduce((sum, month) => sum + month.transactionCount, 0)
        baselineOutgoing = hasBaseline ? roundMovementValue(average(previousMonths)) : null
        baselineMonthStart = hasBaseline ? addUtcMonths(latest.monthStart, -5) : null
        delta = baselineOutgoing === null ? null : roundMovementValue(latestOutgoing - baselineOutgoing)
        percentageChange = baselineOutgoing === null
          ? null
          : roundMovementValue(movementPercentage(latestOutgoing, baselineOutgoing))
        signal = baselineOutgoing === null
          ? null
          : buildMovementSignal({
            vendorLabel: vendor.vendorLabel,
            comparison,
            monthStart: latest.monthStart,
            currentOutgoing: latestOutgoing,
            baselineOutgoing,
            baselineMonthStart,
            hadPriorSpendBeforeCurrent: hasPriorSpendBefore(monthMapForMovement(vendor.months), addUtcMonths(latest.monthStart, -2)),
          })
      }
      const totalOutgoing = roundMovementValue(months.reduce((sum, month) => sum + month.totalOutgoing, 0))
      const transactionCount = months.reduce((sum, month) => sum + month.transactionCount, 0)

      if (!signal && totalOutgoing <= 0 && transactionCount === 0) {
        return null
      }

      return {
        vendorLabel: vendor.vendorLabel,
        range,
        comparison,
        months,
        latestMonthStart: latest?.monthStart ?? null,
        latestOutgoing,
        latestTransactionCount,
        baselineMonthStart,
        baselineOutgoing,
        delta,
        percentageChange,
        signal,
        totalOutgoing,
        transactionCount,
      }
    })
    .filter((summary): summary is ReceiptVendorMovementSummary => Boolean(summary))
    .sort((a, b) => {
      const aAbsoluteDelta = Math.abs(a.delta ?? 0)
      const bAbsoluteDelta = Math.abs(b.delta ?? 0)
      if (aAbsoluteDelta !== bAbsoluteDelta) return bAbsoluteDelta - aAbsoluteDelta

      return b.latestOutgoing - a.latestOutgoing
    })
}

function suggestedReviewForSignal(signal: ReceiptVendorCostSignal | ReceiptVendorMovementSignal): string {
  if (signal.direction === 'new') {
    return 'Check whether this is a new supplier, a corrected vendor name, or a one-off purchase.'
  }

  if (signal.direction === 'resumed') {
    return 'Check whether this supplier restarted, moved back from another vendor name, or reflects a one-off catch-up payment.'
  }

  if (signal.direction === 'drop') {
    return 'Check whether the supplier genuinely stopped, moved to another vendor name, or recent statements are missing.'
  }

  return 'Check recent invoices, standing orders, and one-off purchases behind the higher spend.'
}

export function buildDeterministicVendorAiReview(
  signals: ReceiptVendorCostSignal[],
  options: {
    generatedAt?: string
    scopeLabel?: string
    movementSignals?: ReceiptVendorMovementSignal[]
  } = {},
): ReceiptVendorAiReview {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const allSignals = [...signals, ...(options.movementSignals ?? [])]
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
      return b.absoluteDelta - a.absoluteDelta
    })
  const highCount = allSignals.filter((signal) => signal.severity === 'high').length
  const scopeLabel = options.scopeLabel ?? 'vendor costs'

  const overview = allSignals.length === 0
    ? `No material spikes or drops were found in ${scopeLabel}.`
    : `${allSignals.length} ${allSignals.length === 1 ? 'vendor change needs' : 'vendor changes need'} review, including ${highCount} high-priority ${highCount === 1 ? 'change' : 'changes'}.`

  return {
    overview,
    reviewItems: allSignals.slice(0, 8).map((signal) => ({
      vendorLabel: signal.vendorLabel,
      severity: signal.severity,
      direction: signal.direction,
      reason: signal.reason,
      suggestedReview: suggestedReviewForSignal(signal),
    })),
    source: 'deterministic',
    generatedAt,
  }
}
