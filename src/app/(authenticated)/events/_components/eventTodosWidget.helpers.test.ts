import { describe, it, expect } from 'vitest'
import {
  daysBetweenIso,
  formatRelativeDue,
  summariseTodos,
  formatSummaryLine,
} from './eventTodosWidget.helpers'

describe('daysBetweenIso', () => {
  it('counts whole days between ISO dates regardless of local timezone', () => {
    expect(daysBetweenIso('2026-05-18', '2026-05-21')).toBe(3)
    expect(daysBetweenIso('2026-05-21', '2026-05-21')).toBe(0)
  })
})

describe('formatRelativeDue', () => {
  it('labels overdue items by day count', () => {
    expect(formatRelativeDue('2026-05-18', '2026-05-21')).toBe('Overdue by 3d')
  })
  it('labels due-today items', () => {
    expect(formatRelativeDue('2026-05-21', '2026-05-21')).toBe('Due today')
  })
  it('labels future items', () => {
    expect(formatRelativeDue('2026-05-26', '2026-05-21')).toBe('Due in 5d')
  })
})

describe('summariseTodos', () => {
  it('counts by status', () => {
    expect(
      summariseTodos([{ status: 'overdue' }, { status: 'overdue' }, { status: 'due_today' }]),
    ).toEqual({ overdue: 2, dueToday: 1 })
  })
  it('handles empty input', () => {
    expect(summariseTodos([])).toEqual({ overdue: 0, dueToday: 0 })
  })
})

describe('formatSummaryLine', () => {
  it('joins non-zero parts', () => {
    expect(formatSummaryLine({ overdue: 3, dueToday: 2 })).toBe('3 overdue · 2 due today')
  })
  it('omits zero parts', () => {
    expect(formatSummaryLine({ overdue: 0, dueToday: 2 })).toBe('2 due today')
  })
})
