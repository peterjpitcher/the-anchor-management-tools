import { describe, it, expect } from 'vitest'

function formatEntryLine(e: {
  entry_date: string
  start_at: string | null
  end_at: string | null
  duration_minutes_rounded: number | null
  description?: string | null
  work_type_name_snapshot?: string | null
}): string {
  const hours = Number(e.duration_minutes_rounded || 0) / 60
  const workType = e.work_type_name_snapshot || 'General'
  const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''

  if (e.start_at) {
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false,
      }).format(new Date(iso))
    const start = fmt(e.start_at)
    const end = e.end_at ? fmt(e.end_at) : ''
    return `    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`
  }

  return `    - ${e.entry_date} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`
}

describe('invoice entry line formatting', () => {
  it('includes time range for entries with start_at', () => {
    const line = formatEntryLine({
      entry_date: '2026-01-15',
      start_at: '2026-01-15T09:00:00.000Z',
      end_at: '2026-01-15T10:30:00.000Z',
      duration_minutes_rounded: 90,
      work_type_name_snapshot: 'Development',
      description: 'Fixed the bug',
    })
    expect(line).toContain('09:00–10:30')
    expect(line).toContain('(1.50h)')
    expect(line).toContain('[Development]')
    expect(line).toContain('Fixed the bug')
  })

  it('omits time range for entries without start_at', () => {
    const line = formatEntryLine({
      entry_date: '2026-03-12',
      start_at: null,
      end_at: null,
      duration_minutes_rounded: 60,
      work_type_name_snapshot: 'Development',
      description: null,
    })
    expect(line).not.toContain('–')
    expect(line).toBe('    - 2026-03-12 (1.00h) [Development]')
  })

  it('handles null description and null work type without errors', () => {
    const line = formatEntryLine({
      entry_date: '2026-03-12',
      start_at: null,
      end_at: null,
      duration_minutes_rounded: 30,
      work_type_name_snapshot: null,
      description: null,
    })
    expect(line).toContain('[General]')
    expect(line).not.toMatch(/undefined|null/)
  })
})
