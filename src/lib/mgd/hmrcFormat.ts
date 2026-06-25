export type MgdHmrcReturnSummary = {
  total_net_take: number | null | undefined
  total_mgd: number | null | undefined
  collection_count?: number | null
}

export type MgdHmrcLine = {
  box: number
  label: string
  value: string
}

function wholePounds(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0)
}

function fmtWhole(value: number): string {
  return `£${wholePounds(value).toFixed(2)}`
}

export function buildMgdHmrcLines(returnSummary: MgdHmrcReturnSummary): MgdHmrcLine[] {
  const netTake = wholePounds(Number(returnSummary.total_net_take ?? 0))
  const mgd = wholePounds(Number(returnSummary.total_mgd ?? 0))
  const machineCount = Math.max(0, Math.round(Number(returnSummary.collection_count ?? 0)))
  const effectiveRate = netTake > 0 ? mgd / netTake : 0
  const lowerRateNetTake = effectiveRate > 0 && effectiveRate <= 0.05 ? netTake : 0
  const lowerRateMgd = effectiveRate > 0 && effectiveRate <= 0.05 ? mgd : 0
  const standardRateNetTake = effectiveRate > 0.05 && effectiveRate <= 0.2 ? netTake : 0
  const standardRateMgd = effectiveRate > 0.05 && effectiveRate <= 0.2 ? mgd : 0
  const higherRateNetTake = effectiveRate > 0.2 ? netTake : 0
  const higherRateMgd = effectiveRate > 0.2 ? mgd : 0

  return [
    { box: 1, label: 'Number of machines available for play at the end of the period', value: String(machineCount) },
    { box: 2, label: 'Total net takings liable to higher rate of duty', value: fmtWhole(higherRateNetTake) },
    { box: 3, label: 'MGD due at higher rate', value: fmtWhole(higherRateMgd) },
    { box: 4, label: 'Total net takings liable to standard rate of duty', value: fmtWhole(standardRateNetTake) },
    { box: 5, label: 'MGD due at standard rate', value: fmtWhole(standardRateMgd) },
    { box: 6, label: 'Total net takings liable to lower rate of duty', value: fmtWhole(lowerRateNetTake) },
    { box: 7, label: 'MGD due at lower rate', value: fmtWhole(lowerRateMgd) },
    { box: 8, label: 'Duty payable before any adjustments', value: fmtWhole(mgd) },
    { box: 9, label: 'Under declared duty from previous MGD periods', value: fmtWhole(0) },
    { box: 10, label: 'Amount of duty brought forward', value: fmtWhole(0) },
    { box: 11, label: 'Negative amount of duty to carry forward to next return', value: fmtWhole(0) },
    { box: 12, label: 'Net duty payable on this return', value: fmtWhole(mgd) },
  ]
}
