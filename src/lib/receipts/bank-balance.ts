export type BankBalanceRow = {
  id: string
  transaction_date: string | null
  amount_in: number | null
  amount_out: number | null
  balance: number | null
}

export type BankBalancePoint = {
  date: string
  balance: number
}

export const BANK_BALANCE_RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '3m', label: '3 months', days: 90 },
  { key: '6m', label: '6 months', days: 180 },
  { key: '1y', label: '1 year', days: 365 },
  { key: '3y', label: '3 years', days: 365 * 3 },
  { key: 'all', label: 'All time', days: null },
] as const

export type BankBalanceRange = (typeof BANK_BALANCE_RANGES)[number]['key']

type BalanceEdge = {
  id: string
  before: number
  after: number
}

function toPence(value: number): number {
  return Math.round(value * 100)
}

function toAmount(value: number | null): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function resolveClosingBalance(rows: BankBalanceRow[], previousBalance: number | null): number {
  const edges: BalanceEdge[] = rows.map((row) => {
    const after = toPence(Number(row.balance))
    const movement = toPence(toAmount(row.amount_in) - toAmount(row.amount_out))
    return { id: row.id, before: after - movement, after }
  })

  const unused = new Set(edges.map((_, index) => index))
  const afterValues = new Set(edges.map((edge) => edge.after))
  const preferredBefore = previousBalance === null ? null : toPence(previousBalance)

  let currentIndex = preferredBefore === null
    ? undefined
    : edges.findIndex((edge) => edge.before === preferredBefore)

  if (currentIndex === -1 || currentIndex === undefined) {
    currentIndex = edges.findIndex((edge) => !afterValues.has(edge.before))
  }

  if (currentIndex >= 0) {
    let current = edges[currentIndex]
    unused.delete(currentIndex)

    while (unused.size > 0) {
      const nextIndex = [...unused]
        .filter((index) => edges[index].before === current.after)
        .sort((left, right) => edges[left].id.localeCompare(edges[right].id))[0]

      if (nextIndex === undefined) break
      current = edges[nextIndex]
      unused.delete(nextIndex)
    }

    if (unused.size === 0) return current.after / 100
  }

  const beforeValues = new Set(edges.map((edge) => edge.before))
  const closingCandidates = edges
    .filter((edge) => !beforeValues.has(edge.after))
    .sort((left, right) => left.id.localeCompare(right.id))

  const fallback = closingCandidates.at(-1) ?? [...edges].sort((left, right) => left.id.localeCompare(right.id)).at(-1)
  return (fallback?.after ?? 0) / 100
}

/**
 * Converts transaction balances into one reliable closing balance per day.
 * Rows on the same day are reconstructed from their before/after balances so
 * database row order cannot change the plotted closing balance.
 */
export function buildDailyBankBalanceSeries(rows: BankBalanceRow[]): BankBalancePoint[] {
  const rowsByDate = new Map<string, BankBalanceRow[]>()

  for (const row of rows) {
    const balance = Number(row.balance)
    if (!row.transaction_date || !Number.isFinite(balance)) continue
    const existing = rowsByDate.get(row.transaction_date) ?? []
    existing.push(row)
    rowsByDate.set(row.transaction_date, existing)
  }

  const points: BankBalancePoint[] = []
  let previousBalance: number | null = null

  for (const date of [...rowsByDate.keys()].sort()) {
    const balance = resolveClosingBalance(rowsByDate.get(date) ?? [], previousBalance)
    points.push({ date, balance })
    previousBalance = balance
  }

  return points
}

export function filterBankBalancePoints(
  points: BankBalancePoint[],
  range: BankBalanceRange,
): BankBalancePoint[] {
  if (range === 'all' || points.length === 0) return points

  const config = BANK_BALANCE_RANGES.find((item) => item.key === range)
  if (!config?.days) return points

  const latest = points.at(-1)?.date
  if (!latest) return points

  const start = new Date(`${latest}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (config.days - 1))
  const startDate = start.toISOString().slice(0, 10)
  return points.filter((point) => point.date >= startDate)
}
