/**
 * Whether a bank account's running balance joins up.
 *
 * Every bank line carries the balance after it, so it also says what the balance was before it:
 * the balance, less the money in, plus the money out. Laid end to end, every line opens on the
 * balance the line before it closed on. Where one does not, something is missing between them:
 * a line the importer skipped, a download that stopped part way through a month, or a whole
 * statement never uploaded. The difference is what the missing lines add up to.
 *
 * Lines held for one day do not record their order, so the order is rebuilt from the balances.
 * A day can often be put together more than one way (a deposit and a withdrawal of the same
 * amount), so this searches for an order that joins up before it calls anything a gap: a false
 * alarm would send someone looking for payments that were never missing.
 *
 * Pure: no database access. Money is handled in pence.
 */

import { formatDateInLondon } from '@/lib/dateUtils'
import { formatCurrency } from '@/lib/format'

export type BalanceLine = {
  /** YYYY-MM-DD */
  date: string
  amountIn: number | null
  amountOut: number | null
  /** The balance after the line. */
  balance: number | null
}

export type BalanceGap = {
  /** Date of the last line before the break. */
  fromDate: string
  /** The balance after that line. */
  fromBalance: number
  /** Date of the first line after the break. */
  toDate: string
  /** The balance that line started from. */
  toOpeningBalance: number
  /** What the missing lines add up to: toOpeningBalance less fromBalance. Negative is money out. */
  missingNet: number
}

export type BalanceContinuity = {
  gaps: BalanceGap[]
  /** Lines held twice: the same date, amounts and balance, where dropping the copy joins the balance up. */
  repeated: BalanceLine[]
  /** Lines with no balance, which cannot be checked. */
  unchecked: number
}

type Node = { line: BalanceLine; opening: number; closing: number }

/** Steps the order search may take on one day before it settles for what it has. */
const DAY_SEARCH_BUDGET = 20_000

function pence(value: number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100)
}

function hasBalance(line: BalanceLine): boolean {
  return line.balance !== null && line.balance !== undefined && Number.isFinite(Number(line.balance))
}

/** The longest run of lines from `start`, each opening where the one before it closed. */
function longestRun(start: number, pool: Node[], budget: { left: number }): Node[] {
  let best: Node[] = []
  const used = new Set<Node>()
  const path: Node[] = []

  const visit = (balance: number): boolean => {
    if (path.length > best.length) best = [...path]
    if (best.length === pool.length) return true
    for (const node of pool) {
      if (budget.left <= 0) return true
      if (used.has(node) || node.opening !== balance) continue
      budget.left -= 1
      used.add(node)
      path.push(node)
      const done = visit(node.closing)
      path.pop()
      used.delete(node)
      if (done) return true
    }
    return false
  }

  visit(start)
  return best
}

type Run = { nodes: Node[]; afterBreak: boolean }

/**
 * One day's lines as runs that join up. The first run starts from the day before's closing
 * balance when a line opens there; a run that cannot start from where the last one ended is a
 * break.
 */
function arrangeDay(nodes: Node[], startBalance: number | null, budget: { left: number }): Run[] {
  const runs: Run[] = []
  let remaining = nodes
  let start = startBalance

  while (remaining.length) {
    let run = start === null ? [] : longestRun(start, remaining, budget)
    const afterBreak = run.length === 0 && start !== null

    if (!run.length) {
      // A run has to begin somewhere. Prefer a line that no other line here closes onto, then
      // whichever beginning reaches furthest.
      const heads = remaining.filter((node) => !remaining.some((other) => other !== node && other.closing === node.opening))
      for (const head of heads.length ? heads : remaining) {
        const rest = remaining.filter((node) => node !== head)
        const candidate = [head, ...longestRun(head.closing, rest, budget)]
        if (candidate.length > run.length) run = candidate
        if (run.length === remaining.length) break
      }
    }

    runs.push({ nodes: run, afterBreak })
    const placed = new Set(run)
    remaining = remaining.filter((node) => !placed.has(node))
    start = run[run.length - 1].closing
  }

  return runs
}

function findGaps(lines: BalanceLine[]): BalanceGap[] {
  const byDate = new Map<string, Node[]>()
  for (const line of lines) {
    const closing = pence(line.balance)
    const node: Node = { line, closing, opening: closing - pence(line.amountIn) + pence(line.amountOut) }
    byDate.set(line.date, [...(byDate.get(line.date) ?? []), node])
  }

  const breaks: Array<{ fromDate: string; fromBalance: number; toDate: string; toOpening: number }> = []
  // Declared through `as`: assigned only inside the loops, it would otherwise narrow to null.
  let last = null as { date: string; balance: number } | null

  for (const date of [...byDate.keys()].sort()) {
    // Each day has its own search budget, so one awkward day cannot leave the rest unsearched.
    for (const run of arrangeDay(byDate.get(date) ?? [], last?.balance ?? null, { left: DAY_SEARCH_BUDGET })) {
      if (run.afterBreak && last) {
        breaks.push({ fromDate: last.date, fromBalance: last.balance, toDate: date, toOpening: run.nodes[0].opening })
      }
      last = { date, balance: run.nodes[run.nodes.length - 1].closing }
    }
  }

  // Missing lines in the middle of a busy day leave its order uncertain, so the day can come
  // apart in more than one place. Breaks that touch are one stretch: the amounts at each break
  // mean nothing on their own, but they add up to what is missing across the stretch.
  const gaps: BalanceGap[] = []
  for (const piece of breaks) {
    const previous = gaps[gaps.length - 1]
    if (previous && piece.fromDate <= previous.toDate) {
      previous.toDate = piece.toDate
      previous.toOpeningBalance = piece.toOpening / 100
      previous.missingNet = Math.round((previous.missingNet * 100) + piece.toOpening - piece.fromBalance) / 100
      continue
    }
    gaps.push({
      fromDate: piece.fromDate,
      fromBalance: piece.fromBalance / 100,
      toDate: piece.toDate,
      toOpeningBalance: piece.toOpening / 100,
      missingNet: (piece.toOpening - piece.fromBalance) / 100,
    })
  }

  return gaps
}

function lineKey(line: BalanceLine): string {
  return `${line.date}|${pence(line.amountIn)}|${pence(line.amountOut)}|${pence(line.balance)}`
}

/**
 * Where the running balance of these bank lines breaks, and any line held twice.
 *
 * Two lines with the same date, amounts and balance can both be genuine (a deposit, a
 * withdrawal and the same deposit again), so a copy is only called a repeat when the balance
 * joins up better without it.
 */
export function checkBalanceContinuity(lines: BalanceLine[]): BalanceContinuity {
  const checkable = lines.filter(hasBalance)
  const unchecked = lines.length - checkable.length

  const gaps = findGaps(checkable)
  if (!gaps.length) return { gaps, repeated: [], unchecked }

  const seen = new Set<string>()
  const withoutRepeats: BalanceLine[] = []
  const repeated: BalanceLine[] = []
  for (const line of checkable) {
    const key = lineKey(line)
    if (seen.has(key)) repeated.push(line)
    else {
      seen.add(key)
      withoutRepeats.push(line)
    }
  }
  if (!repeated.length) return { gaps, repeated: [], unchecked }

  const gapsWithoutRepeats = findGaps(withoutRepeats)
  return gapsWithoutRepeats.length < gaps.length
    ? { gaps: gapsWithoutRepeats, repeated, unchecked }
    : { gaps, repeated: [], unchecked }
}

function formatDay(isoDate: string): string {
  return formatDateInLondon(isoDate, { day: 'numeric', month: 'long', year: 'numeric' })
}

const GAPS_LISTED = 3

/** A plain message for the person who uploaded the statement, or null when everything joins up. */
export function describeBalanceContinuity(result: BalanceContinuity): string | null {
  const parts: string[] = []

  if (result.gaps.length) {
    const listed = result.gaps.slice(0, GAPS_LISTED).map((gap) => {
      const when = gap.fromDate === gap.toDate ? `on ${formatDay(gap.toDate)}` : `between ${formatDay(gap.fromDate)} and ${formatDay(gap.toDate)}`
      const amount = formatCurrency(Math.abs(gap.missingNet))
      return `${when}, ${amount} more ${gap.missingNet < 0 ? 'went out' : 'came in'} than the payments held show`
    })
    const more = result.gaps.length - listed.length
    parts.push(
      `The bank balance does not join up, so some payments are probably missing: ${listed.join('; ')}${
        more > 0 ? `; and ${more} more ${more === 1 ? 'place' : 'places'}` : ''
      }. Upload the full statement for those dates.`
    )
  }

  if (result.repeated.length) {
    const count = result.repeated.length
    parts.push(
      `${count} ${count === 1 ? 'payment is' : 'payments are'} held twice with the same date, amount and balance. Check for a duplicate upload.`
    )
  }

  return parts.length ? parts.join(' ') : null
}
