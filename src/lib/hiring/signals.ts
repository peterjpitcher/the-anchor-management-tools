import type { EmploymentTimelineEntry } from '@/lib/hiring/parsing'

const BAR_TITLE_REGEX = /\b(bartender|bar staff|bar staffer|bar supervisor|bar-supervisor|barback|bar back|bar team|bar associate|bar manager|barmaid|barman)\b/i
const HOSPITALITY_TITLE_REGEX = /\b(bartender|bar|server|waiter|waitress|host|hostess|runner|barista|kitchen|chef|cook|hospitality|restaurant|pub|hotel|cafe)\b/i

type DateParts = { year: number; month: number }

function parseDateParts(value: string): DateParts | null {
    const raw = value.trim().toLowerCase()
    if (!raw) return null
    if (/(present|current|now)/i.test(raw)) {
        const now = new Date()
        return { year: now.getFullYear(), month: now.getMonth() }
    }

    const isoMatch = raw.match(/(\d{4})[-/](\d{1,2})/)
    if (isoMatch) {
        const year = Number(isoMatch[1])
        const month = Number(isoMatch[2]) - 1
        if (year > 1900 && month >= 0 && month <= 11) {
            return { year, month }
        }
    }

    const monthNames: Record<string, number> = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11,
    }

    const monthMatch = raw.match(/([a-z]{3,9})\s+(\d{4})/)
    if (monthMatch) {
        const month = monthNames[monthMatch[1]]
        const year = Number(monthMatch[2])
        if (month != null && year > 1900) {
            return { year, month }
        }
    }

    const yearMatch = raw.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
        const year = Number(yearMatch[0])
        return { year, month: 0 }
    }

    return null
}

function monthsBetween(start: DateParts, end: DateParts) {
    const startIndex = start.year * 12 + start.month
    const endIndex = end.year * 12 + end.month
    if (endIndex < startIndex) return 0
    return endIndex - startIndex + 1
}

function isBarTitle(title: string) {
    return BAR_TITLE_REGEX.test(title)
}

function isHospitalityTitle(title: string) {
    return HOSPITALITY_TITLE_REGEX.test(title)
}

export type ExperienceSignals = {
    bar_experience_months?: number | null
    hospitality_experience_months?: number | null
    bar_experience_confidence: number
    bar_roles_detected: string[]
    bar_evidence_quotes: string[]
    bar_evidence_anchors: string[]
    bar_dates_explicit: boolean
}

export function computeExperienceSignals(timeline: EmploymentTimelineEntry[] = []): ExperienceSignals {
    const barRoles = new Set<string>()
    const barQuotes: string[] = []
    const barAnchors: string[] = []
    let barMonths = 0
    let hospitalityMonths = 0
    let barEntries = 0
    let barEntriesWithDates = 0
    let hospitalityEntries = 0
    let hospitalityEntriesWithDates = 0

    timeline.forEach((entry) => {
        const titles = Array.isArray(entry.titles) ? entry.titles : []
        const isBar = entry.is_bar_role === true || titles.some((title) => isBarTitle(title))
        const isHospitality = entry.is_hospitality === true || titles.some((title) => isHospitalityTitle(title))

        if (isBar) {
            barEntries += 1
            titles.forEach((title) => {
                if (isBarTitle(title)) {
                    barRoles.add(title.trim())
                }
            })
            if (Array.isArray(entry.evidence_quotes)) {
                entry.evidence_quotes.forEach((quote) => {
                    if (quote?.quote) barQuotes.push(quote.quote)
                    if (quote?.anchor) barAnchors.push(quote.anchor)
                })
            }
        }

        if (isHospitality) {
            hospitalityEntries += 1
        }

        const start = entry.start_date ? parseDateParts(entry.start_date) : null
        const end = entry.end_date ? parseDateParts(entry.end_date) : null
        if (start && end) {
            const months = monthsBetween(start, end)
            if (isBar) {
                barMonths += months
                barEntriesWithDates += 1
            }
            if (isHospitality) {
                hospitalityMonths += months
                hospitalityEntriesWithDates += 1
            }
        }
    })

    const barConfidence = barEntries > 0
        ? Number((0.4 + 0.6 * (barEntriesWithDates / Math.max(1, barEntries))).toFixed(2))
        : 0

    const hospitalityConfidence = hospitalityEntries > 0
        ? Number((0.4 + 0.6 * (hospitalityEntriesWithDates / Math.max(1, hospitalityEntries))).toFixed(2))
        : 0

    return {
        bar_experience_months: barEntriesWithDates ? barMonths : null,
        hospitality_experience_months: hospitalityEntriesWithDates ? hospitalityMonths : null,
        bar_experience_confidence: barConfidence,
        bar_roles_detected: Array.from(barRoles),
        bar_evidence_quotes: barQuotes.slice(0, 3),
        bar_evidence_anchors: barAnchors.slice(0, 3),
        bar_dates_explicit: barEntriesWithDates > 0,
    }
}

