import { describe, expect, it } from 'vitest'
import { rankActions } from '@/lib/insights/actions'
import { mergeSignals, scoreSignal } from '@/lib/insights/signals'
import { buildSummary } from '@/lib/insights/summary'
import { computeWindows } from '@/lib/insights/windows'
import type { InsightAction, InsightSection, InsightSignal, SectionKey } from '@/lib/insights/types'

const windows = computeWindows(new Date('2026-09-25T05:00:00Z'))
const today = windows.today

function act(text: string, overrides: Partial<InsightAction> = {}): InsightAction {
  return { text, href: 'https://management.example.test/x', target: 'record', impact: 'housekeeping', ...overrides }
}

function sig(key: string, overrides: Partial<InsightSignal> = {}): InsightSignal {
  return { key, rag: 'amber', kind: 'issue', text: `${key} text`, emailSafe: true, ...overrides }
}

function sec(key: SectionKey, status: InsightSection['status'], signals: InsightSignal[], extra: Partial<InsightSection> = {}): InsightSection {
  return { key, title: key, href: `https://management.example.test/${key}`, status, headline: '', metrics: [], lists: [], signals, notes: [], ...extra }
}

describe('scoreSignal', () => {
  it('adds severity, urgency and impact', () => {
    expect(scoreSignal(sig('a', { rag: 'red', action: act('x', { dueDate: '2026-09-26', impact: 'money' }) }), today)).toBe(300 + 60 + 30)
    expect(scoreSignal(sig('b', { rag: 'amber', action: act('x', { dueDate: '2026-09-30', impact: 'staffing' }) }), today)).toBe(200 + 40 + 20)
    expect(scoreSignal(sig('c', { rag: 'amber', action: act('x', { dueDate: '2026-10-20' }) }), today)).toBe(200)
    expect(scoreSignal(sig('d', { kind: 'win', rag: 'green' }), today)).toBe(100)
    expect(scoreSignal(sig('e', { kind: 'info', rag: 'green' }), today)).toBe(0)
  })
})

describe('rankActions', () => {
  it('puts every red first, fills with amber, then at most two greens, capped at ten', () => {
    const reds = Array.from({ length: 3 }, (_, i) => sig(`red${i}`, { rag: 'red', action: act(`Red ${i}`) }))
    const ambers = Array.from({ length: 4 }, (_, i) => sig(`amber${i}`, { action: act(`Amber ${i}`) }))
    const wins = Array.from({ length: 4 }, (_, i) => sig(`win${i}`, { kind: 'win', rag: 'green', action: act(`Win ${i}`) }))
    const { actions, moreRedActions } = rankActions([sec('events', 'red', [...wins, ...ambers, ...reds])], today)
    expect(actions.map((a) => a.text)).toEqual(['Red 0', 'Red 1', 'Red 2', 'Amber 0', 'Amber 1', 'Amber 2', 'Amber 3', 'Win 0', 'Win 1'])
    expect(moreRedActions).toBe(0)
  })

  it('shows ten reds and counts the rest when there are more than ten', () => {
    const reds = Array.from({ length: 12 }, (_, i) => sig(`red${String(i).padStart(2, '0')}`, { rag: 'red', action: act(`Red ${i}`) }))
    const { actions, moreRedActions } = rankActions([sec('rota', 'red', reds)], today)
    expect(actions).toHaveLength(10)
    expect(actions.every((a) => a.rag === 'red')).toBe(true)
    expect(moreRedActions).toBe(2)
  })

  it('orders by urgency, then section order, and ignores not-checked sections', () => {
    const soon = sig('soon', { rag: 'red', action: act('Soon', { dueDate: '2026-09-26' }) })
    const later = sig('later', { rag: 'red', action: act('Later', { dueDate: '2026-10-05' }) })
    const hidden = sig('hidden', { rag: 'red', action: act('Hidden') })
    const { actions } = rankActions([
      sec('events', 'red', [later]),
      sec('customers', 'not_checked', [hidden]),
      sec('parking', 'red', [soon]),
    ], today)
    expect(actions.map((a) => a.text)).toEqual(['Soon', 'Later'])
  })
})

describe('buildSummary', () => {
  it('counts sections by status and never takes the biggest win from a red section', () => {
    const sections = [
      sec('events', 'red', [sig('r', { rag: 'red', action: act('Promote') }), sig('w1', { kind: 'win', rag: 'green', text: 'Red-section win' })]),
      sec('customers', 'green', [sig('w2', { kind: 'win', rag: 'green', text: 'Customers up 30%' })]),
      sec('parking', 'not_checked', []),
    ]
    const { actions } = rankActions(sections, today)
    const summary = buildSummary(sections, actions, windows)
    expect(summary.counts).toEqual({ red: 1, amber: 0, green: 1, not_checked: 1 })
    expect(summary.biggestWin).toEqual({ text: 'Customers up 30%', sectionKey: 'customers' })
    expect(summary.biggestConcern).toMatchObject({ text: 'r text', rag: 'red' })
    expect(summary.mostUrgentAction?.text).toBe('Promote')
  })

  it('uses the action text when a concern names someone who is not to be printed', () => {
    const sections = [sec('checklists', 'red', [sig('m', { rag: 'red', emailSafe: false, text: 'Amanda missed 4 checks', action: act('Review repeated missed checks') })])]
    const summary = buildSummary(sections, rankActions(sections, today).actions, windows)
    expect(summary.biggestConcern?.text).toBe('Review repeated missed checks')
  })

  it('prefers an upcoming item with an issue, then the earliest date, within the next 7 days', () => {
    const sections = [
      sec('events', 'green', [], { upcoming: [{ date: '2026-09-26', text: 'Quiz, Sat 26 Sep', hasIssue: false }] }),
      sec('private_hire', 'red', [], { upcoming: [
        { date: '2026-09-29', text: 'Smith party, Tue 29 Sep', hasIssue: true },
        { date: '2026-10-09', text: 'Too far ahead', hasIssue: true },
      ] }),
    ]
    const summary = buildSummary(sections, [], windows)
    expect(summary.comingUp?.text).toBe('Smith party, Tue 29 Sep')
  })

  it('has no win or concern when nothing qualifies', () => {
    const summary = buildSummary([sec('events', 'green', [])], [], windows)
    expect(summary.biggestWin).toBeNull()
    expect(summary.biggestConcern).toBeNull()
    expect(summary.comingUp).toBeNull()
  })
})

describe('mergeSignals', () => {
  it('merges above the threshold into one list action with every member', () => {
    const shifts = ['Mon 28 Sep bar 18:00', 'Tue 29 Sep kitchen 12:00'].map((text, i) =>
      sig(`shift${i}`, { rag: 'red', action: act(`Cover ${text}`, { dueDate: `2026-09-2${8 + i}` }) }))
    const merged = mergeSignals(shifts, {
      above: 1,
      key: 'rota.open_shifts',
      rag: 'red',
      text: (n) => `${n} open shifts in the next 14 days`,
      action: { text: 'Cover 2 open shifts', href: 'https://management.example.test/rota', impact: 'staffing' },
    })
    expect(merged).toHaveLength(1)
    expect(merged[0].action).toMatchObject({ target: 'list', members: ['Cover Mon 28 Sep bar 18:00', 'Cover Tue 29 Sep kitchen 12:00'], dueDate: '2026-09-28' })
    expect(mergeSignals(shifts.slice(0, 1), { above: 1, key: 'k', rag: 'red', text: () => '', action: { text: '', href: '', impact: 'staffing' } })).toHaveLength(1)
  })
})
