import { ACTION_SCORING } from './thresholds'
import { daysBetween } from './windows'
import type { ActionImpact, InsightAction, InsightSignal, Rag, SectionStatus } from './types'

/** Signal rules shared by the engine, summary and actions (spec 4.5 to 4.7). */

export function ragRank(rag: Rag): number {
  return rag === 'red' ? 3 : rag === 'amber' ? 2 : 1
}

/** Worst rag among issue signals; green when there are none. */
export function sectionStatusOf(signals: InsightSignal[]): SectionStatus {
  let worst: Rag = 'green'
  for (const signal of signals) {
    if (signal.kind === 'issue' && ragRank(signal.rag) > ragRank(worst)) worst = signal.rag
  }
  return worst
}

function urgencyPoints(dueDate: string | undefined, today: string): number {
  if (!dueDate) return 0
  const days = daysBetween(today, dueDate)
  for (const band of ACTION_SCORING.urgency) {
    if (days <= band.withinDays) return band.points
  }
  return 0
}

/** Severity + urgency + impact. Info signals score zero and never become actions. */
export function scoreSignal(signal: InsightSignal, today: string): number {
  if (signal.kind === 'info') return 0
  const severity = signal.kind === 'win'
    ? ACTION_SCORING.severity.win
    : signal.rag === 'red' ? ACTION_SCORING.severity.red
      : signal.rag === 'amber' ? ACTION_SCORING.severity.amber : ACTION_SCORING.severity.win
  const impact: ActionImpact | undefined = signal.action?.impact
  return severity + urgencyPoints(signal.action?.dueDate, today) + (impact ? ACTION_SCORING.impact[impact] : 0)
}

/**
 * One primary action per record (spec 4.5). When several rules fire for the same entity,
 * every fact is kept as text, but only the most severe signal keeps its action; ties go to
 * the rule that appears first, which is the section's precedence order.
 */
export function dedupeByEntity(signals: InsightSignal[]): InsightSignal[] {
  const primary = new Map<string, number>()
  signals.forEach((signal, index) => {
    if (!signal.entity || !signal.action) return
    const current = primary.get(signal.entity)
    if (current === undefined) {
      primary.set(signal.entity, index)
      return
    }
    const held = signals[current]
    const heldRank = held.kind === 'win' ? 0 : ragRank(held.rag)
    const rank = signal.kind === 'win' ? 0 : ragRank(signal.rag)
    if (rank > heldRank) primary.set(signal.entity, index)
  })
  return signals.map((signal, index) => {
    if (!signal.entity || !signal.action) return signal
    if (primary.get(signal.entity) === index) return signal
    const { action: _dropped, ...rest } = signal
    return rest
  })
}

/** Display order within a section: red, amber, wins, then information. Stable otherwise. */
export function orderSignals(signals: InsightSignal[]): InsightSignal[] {
  const weight = (signal: InsightSignal): number =>
    signal.kind === 'issue' ? 10 - ragRank(signal.rag) : signal.kind === 'win' ? 20 : 30
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => weight(a.signal) - weight(b.signal) || a.index - b.index)
    .map(({ signal }) => signal)
}

export interface MergeOptions {
  /** Merge only when there are more than this many signals. */
  above: number
  key: string
  rag: Rag
  /** Sentence for the merged signal, given the count. Must be email safe. */
  text: (count: number) => string
  /** Action for the merged signal. `members` is filled from each signal's action text. */
  action: Omit<InsightAction, 'members' | 'target'> & { target?: InsightAction['target'] }
}

/**
 * Merges like signals of one rule into a single list action, for example five open shifts
 * becoming "Cover 5 open shifts". The members are the individual action texts, so the
 * reader still sees every affected item. Returns the input unchanged below the threshold.
 */
export function mergeSignals(signals: InsightSignal[], options: MergeOptions): InsightSignal[] {
  if (signals.length <= options.above) return signals
  // Members must be printable: action texts always are; a signal's own text only when email safe.
  const members = signals
    .map((signal) => signal.action?.text ?? (signal.emailSafe ? signal.text : null))
    .filter((member): member is string => member !== null)
  const dueDates = signals.map((signal) => signal.action?.dueDate).filter((date): date is string => Boolean(date)).sort()
  return [{
    key: options.key,
    rag: options.rag,
    kind: 'issue',
    text: options.text(signals.length),
    emailSafe: true,
    action: {
      ...options.action,
      target: options.action.target ?? 'list',
      members,
      dueDate: options.action.dueDate ?? dueDates[0],
    },
  }]
}
