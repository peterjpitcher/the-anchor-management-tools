import { scoreSignal } from './signals'
import { isInRange } from './windows'
import type { InsightSection, InsightsSummary, InsightWindows, RankedAction, SectionStatus, UpcomingItem } from './types'

/**
 * Executive summary (spec 4.6), derived only from the finished sections and actions.
 * Every text chosen here is email safe: signal text only when marked so, otherwise the
 * signal's action text, which is always printable.
 */
export function buildSummary(sections: InsightSection[], actions: RankedAction[], windows: InsightWindows): InsightsSummary {
  const counts: Record<SectionStatus, number> = { red: 0, amber: 0, green: 0, not_checked: 0 }
  for (const section of sections) counts[section.status] += 1

  const today = windows.today
  let biggestWin: InsightsSummary['biggestWin'] = null
  let winScore = -1
  let biggestConcern: InsightsSummary['biggestConcern'] = null
  let concernScore = -1

  for (const section of sections) {
    if (section.status === 'not_checked') continue
    for (const signal of section.signals) {
      const text = signal.emailSafe ? signal.text : signal.action?.text
      if (!text) continue
      const score = scoreSignal(signal, today)
      // A win from a red section is not the headline good news (review D-04).
      if (signal.kind === 'win' && section.status !== 'red' && score > winScore) {
        biggestWin = { text, sectionKey: section.key }
        winScore = score
      }
      if (signal.kind === 'issue' && signal.rag !== 'green' && score > concernScore) {
        biggestConcern = { text, rag: signal.rag, sectionKey: section.key }
        concernScore = score
      }
    }
  }

  const upcoming: { item: UpcomingItem; order: number }[] = []
  sections.forEach((section, order) => {
    if (section.status === 'not_checked') return
    for (const item of section.upcoming ?? []) {
      if (isInRange(item.date, windows.next7)) upcoming.push({ item, order })
    }
  })
  upcoming.sort((a, b) =>
    Number(b.item.hasIssue) - Number(a.item.hasIssue)
    || a.item.date.localeCompare(b.item.date)
    || a.order - b.order)

  return {
    counts,
    biggestWin,
    biggestConcern,
    mostUrgentAction: actions[0] ?? null,
    comingUp: upcoming[0]?.item ?? null,
  }
}
