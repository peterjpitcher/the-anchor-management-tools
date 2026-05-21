import type { ChecklistTodoItem } from '@/lib/event-checklist'

const MS_PER_DAY = 86_400_000

/** Whole-day difference (toIso - fromIso) using UTC-anchored ISO dates — deterministic and timezone-safe. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  return Math.round((to - from) / MS_PER_DAY)
}

/** Human relative-due label for a todo's due date relative to today. */
export function formatRelativeDue(dueDate: string, todayIso: string): string {
  const overdueBy = daysBetweenIso(dueDate, todayIso) // positive => overdue
  if (overdueBy > 0) return `Overdue by ${overdueBy}d`
  if (overdueBy === 0) return 'Due today'
  return `Due in ${-overdueBy}d`
}

export interface TodoCounts {
  overdue: number
  dueToday: number
}

export function summariseTodos(items: Pick<ChecklistTodoItem, 'status'>[]): TodoCounts {
  let overdue = 0
  let dueToday = 0
  for (const item of items) {
    if (item.status === 'overdue') overdue += 1
    else if (item.status === 'due_today') dueToday += 1
  }
  return { overdue, dueToday }
}

export function formatSummaryLine(counts: TodoCounts): string {
  const parts: string[] = []
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`)
  if (counts.dueToday > 0) parts.push(`${counts.dueToday} due today`)
  return parts.join(' · ')
}
