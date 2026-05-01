export type ReceiptExportPeriod = {
  year: number
  quarter: 1 | 2 | 3 | 4
}

export function getLastCompletedQuarter(now = new Date()): ReceiptExportPeriod {
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1
  const currentYear = now.getUTCFullYear()

  if (currentQuarter === 1) {
    return { year: currentYear - 1, quarter: 4 }
  }

  return {
    year: currentYear,
    quarter: (currentQuarter - 1) as 1 | 2 | 3 | 4,
  }
}
