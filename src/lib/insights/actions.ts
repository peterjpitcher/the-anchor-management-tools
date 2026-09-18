import { ACTION_SCORING } from './thresholds'
import { scoreSignal } from './signals'
import type { ActionImpact, InsightSection, RankedAction } from './types'

/** On equal scores, safety comes first, then money and customers, then staffing, then tidying up. */
const IMPACT_ORDER: ActionImpact[] = ['safety', 'money', 'customer', 'staffing', 'housekeeping']

/**
 * Manager actions (spec 4.7), derived only from the finished sections. Every red goes in
 * first; ambers fill the remaining room; at most two green "keep doing this" actions are
 * added only when there is still room. The order is stable between runs.
 */
export function rankActions(sections: InsightSection[], today: string): { actions: RankedAction[]; moreRedActions: number } {
  const candidates: (RankedAction & { sectionIndex: number })[] = []
  sections.forEach((section, sectionIndex) => {
    if (section.status === 'not_checked') return
    for (const signal of section.signals) {
      if (!signal.action || signal.kind === 'info') continue
      candidates.push({
        ...signal.action,
        rag: signal.rag,
        kind: signal.kind,
        sectionKey: section.key,
        sectionTitle: section.title,
        signalKey: signal.key,
        score: scoreSignal(signal, today),
        sectionIndex,
      })
    }
  })

  candidates.sort((a, b) =>
    b.score - a.score
    || IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact)
    || (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
    || a.sectionIndex - b.sectionIndex
    || a.signalKey.localeCompare(b.signalKey))

  const reds = candidates.filter((action) => action.kind === 'issue' && action.rag === 'red')
  const ambers = candidates.filter((action) => action.kind === 'issue' && action.rag === 'amber')
  const greens = candidates.filter((action) => action.kind === 'win' || (action.kind === 'issue' && action.rag === 'green'))

  const max = ACTION_SCORING.maxActions
  const selected = reds.slice(0, max)
  const moreRedActions = Math.max(0, reds.length - max)
  for (const action of ambers) {
    if (selected.length >= max) break
    selected.push(action)
  }
  let greenCount = 0
  for (const action of greens) {
    if (selected.length >= max || greenCount >= ACTION_SCORING.maxGreenActions) break
    selected.push(action)
    greenCount += 1
  }

  return {
    actions: selected.map(({ sectionIndex: _index, ...action }) => action),
    moreRedActions,
  }
}
