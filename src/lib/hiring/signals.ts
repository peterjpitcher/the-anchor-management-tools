export interface ExperienceEvidenceQuote {
  quote: string
  anchor?: string
}

export interface ExperienceTimelineEntry {
  employer?: string
  titles?: string[]
  start_date?: string
  end_date?: string
  is_bar_role?: boolean
  evidence_quotes?: ExperienceEvidenceQuote[]
}

export interface ExperienceSignals {
  barExperienceMonths: number
  barExperienceQuotes: ExperienceEvidenceQuote[]
}

const MONTH_ALIASES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

function parseMonthYear(value: string | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^present$/i.test(trimmed)) return new Date()

  const match = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{4})$/)
  if (!match) return null

  const monthKey = match[1]?.toLowerCase()
  const year = Number(match[2])
  const month = monthKey ? MONTH_ALIASES[monthKey] : undefined

  if (month === undefined || !Number.isFinite(year)) return null
  return new Date(Date.UTC(year, month, 1))
}

function diffInCalendarMonths(start: Date, end: Date): number {
  const startYear = start.getUTCFullYear()
  const startMonth = start.getUTCMonth()
  const endYear = end.getUTCFullYear()
  const endMonth = end.getUTCMonth()

  const diff = (endYear - startYear) * 12 + (endMonth - startMonth)
  return Math.max(0, diff)
}

export function computeExperienceSignals(timeline: ExperienceTimelineEntry[]): ExperienceSignals {
  const barExperienceQuotes: ExperienceEvidenceQuote[] = []
  let barExperienceMonths = 0

  for (const entry of timeline) {
    if (!entry.is_bar_role) continue

    const start = parseMonthYear(entry.start_date)
    const end = parseMonthYear(entry.end_date) ?? new Date()
    if (start) {
      barExperienceMonths += diffInCalendarMonths(start, end)
    }

    if (entry.evidence_quotes?.length) {
      barExperienceQuotes.push(...entry.evidence_quotes)
    }
  }

  return {
    barExperienceMonths,
    barExperienceQuotes,
  }
}
