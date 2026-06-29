export type MgdHmrcReturnSummary = {
  total_net_take: number | null | undefined
  total_mgd: number | null | undefined
  /** Dutiable machines available for play at the end of the period (Box 1). */
  machine_count?: number | null
}

export type MgdHmrcLine = {
  box: number
  label: string
  value: string
}

/** Coerce to a finite number, defaulting to 0. */
function toAmount(value: number | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Format a GBP amount to the exact penny — never rounded to whole pounds. */
function fmtMoney(value: number): string {
  return `£${toAmount(value).toFixed(2)}`
}

// Tolerance for assigning a return to a duty band from its effective rate.
// The real MGD bands (5% / 20% / 25%) sit ~15 percentage points apart, so a
// 0.5pp tolerance cannot blur one band into another, but it is wide enough to
// absorb the penny-level rounding in stored amounts — that way a return charged
// at exactly the standard 20% rate is never nudged into the higher-rate boxes.
const RATE_TOLERANCE = 0.005

export function buildMgdHmrcLines(returnSummary: MgdHmrcReturnSummary): MgdHmrcLine[] {
  const netTake = toAmount(returnSummary.total_net_take)
  const mgd = toAmount(returnSummary.total_mgd)
  const machineCount = Math.max(0, Math.round(toAmount(returnSummary.machine_count)))
  const effectiveRate = netTake > 0 ? mgd / netTake : 0

  const isLowerRate = effectiveRate > 0 && effectiveRate <= 0.05 + RATE_TOLERANCE
  const isStandardRate = effectiveRate > 0.05 + RATE_TOLERANCE && effectiveRate <= 0.2 + RATE_TOLERANCE
  const isHigherRate = effectiveRate > 0.2 + RATE_TOLERANCE

  const lowerRateNetTake = isLowerRate ? netTake : 0
  const lowerRateMgd = isLowerRate ? mgd : 0
  const standardRateNetTake = isStandardRate ? netTake : 0
  const standardRateMgd = isStandardRate ? mgd : 0
  const higherRateNetTake = isHigherRate ? netTake : 0
  const higherRateMgd = isHigherRate ? mgd : 0

  return [
    { box: 1, label: 'Number of machines available for play at the end of the period', value: String(machineCount) },
    { box: 2, label: 'Total net takings liable to higher rate of duty', value: fmtMoney(higherRateNetTake) },
    { box: 3, label: 'MGD due at higher rate', value: fmtMoney(higherRateMgd) },
    { box: 4, label: 'Total net takings liable to standard rate of duty', value: fmtMoney(standardRateNetTake) },
    { box: 5, label: 'MGD due at standard rate', value: fmtMoney(standardRateMgd) },
    { box: 6, label: 'Total net takings liable to lower rate of duty', value: fmtMoney(lowerRateNetTake) },
    { box: 7, label: 'MGD due at lower rate', value: fmtMoney(lowerRateMgd) },
    { box: 8, label: 'Duty payable before any adjustments', value: fmtMoney(mgd) },
    { box: 9, label: 'Under declared duty from previous MGD periods', value: fmtMoney(0) },
    { box: 10, label: 'Amount of duty brought forward', value: fmtMoney(0) },
    { box: 11, label: 'Negative amount of duty to carry forward to next return', value: fmtMoney(0) },
    { box: 12, label: 'Net duty payable on this return', value: fmtMoney(mgd) },
  ]
}
