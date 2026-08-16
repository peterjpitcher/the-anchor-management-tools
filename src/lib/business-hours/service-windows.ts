// src/lib/business-hours/service-windows.ts
//
// Validation for a day's food service windows. Pure, so the editor and any
// server-side check can share it rather than drifting.
//
// These matter more than they look. The booking engine now refuses a food booking
// outside a service window, so a gap saved here becomes a gap customers cannot
// book across, and a service saved outside kitchen hours becomes a time the
// kitchen is offered but not open.

import type { ScheduleConfigItem } from '@/types/business-hours'

export interface ServiceWindowInput {
  name: string
  starts_at: string
  ends_at: string
}

export interface ServiceWindowProblem {
  index: number | null
  message: string
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function toMinutes(value: string): number | null {
  if (!TIME_RE.test(value)) return null
  const [h, m] = value.split(':')
  return Number(h) * 60 + Number(m)
}

/** Trim a stored 'HH:MM:SS' down to the 'HH:MM' the inputs use. */
export function toClock(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 5)
}

/**
 * Everything wrong with a day's services, in the order a person would fix them.
 *
 * `kitchenOpens` and `kitchenCloses` bound the day. A service outside them is
 * rejected rather than silently clamped: quietly moving somebody's times is worse
 * than telling them the times do not fit.
 */
export function validateServiceWindows(
  services: ServiceWindowInput[],
  kitchenOpens: string | null,
  kitchenCloses: string | null,
): ServiceWindowProblem[] {
  const problems: ServiceWindowProblem[] = []

  if (services.length === 0) return problems

  const kOpen = kitchenOpens ? toMinutes(toClock(kitchenOpens)) : null
  const kClose = kitchenCloses ? toMinutes(toClock(kitchenCloses)) : null

  if (kOpen === null || kClose === null) {
    problems.push({
      index: null,
      message: 'Set the kitchen opening and closing times before adding services.',
    })
    return problems
  }

  const spans: Array<{ index: number; start: number; end: number }> = []

  services.forEach((service, index) => {
    const start = toMinutes(service.starts_at)
    const end = toMinutes(service.ends_at)

    if (start === null || end === null) {
      problems.push({ index, message: 'Give a start and end time.' })
      return
    }
    if (end <= start) {
      problems.push({ index, message: 'The end time has to be after the start time.' })
      return
    }
    if (start < kOpen || end > kClose) {
      problems.push({
        index,
        message: `This runs outside kitchen hours (${toClock(kitchenOpens)} to ${toClock(kitchenCloses)}).`,
      })
      return
    }
    // The booking engine refuses an arrival within 30 minutes of a service
    // ending, so anything shorter than that can never be booked at all.
    if (end - start < 30) {
      problems.push({ index, message: 'A service shorter than 30 minutes cannot be booked.' })
      return
    }
    spans.push({ index, start, end })
  })

  const sorted = [...spans].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      problems.push({ index: sorted[i].index, message: 'This overlaps another service.' })
    }
  }

  return problems
}

/** The uncovered stretches inside kitchen hours, as 'HH:MM to HH:MM' strings. */
export function describeGaps(
  services: ServiceWindowInput[],
  kitchenOpens: string | null,
  kitchenCloses: string | null,
): string[] {
  const kOpen = kitchenOpens ? toMinutes(toClock(kitchenOpens)) : null
  const kClose = kitchenCloses ? toMinutes(toClock(kitchenCloses)) : null
  if (kOpen === null || kClose === null || services.length === 0) return []

  const spans = services
    .map(s => ({ start: toMinutes(s.starts_at), end: toMinutes(s.ends_at) }))
    .filter((s): s is { start: number; end: number } => s.start !== null && s.end !== null)
    .sort((a, b) => a.start - b.start)

  const gaps: string[] = []
  let cursor = kOpen
  for (const span of spans) {
    if (span.start > cursor) gaps.push(`${fromMinutes(cursor)} to ${fromMinutes(span.start)}`)
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < kClose) gaps.push(`${fromMinutes(cursor)} to ${fromMinutes(kClose)}`)
  return gaps
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Merge edited service rows back into a day's schedule_config. */
export function applyServiceWindows(
  existing: ScheduleConfigItem[] | null,
  services: ServiceWindowInput[],
): ScheduleConfigItem[] {
  // Sunday lunch and any other typed slot has its own control and is preserved.
  const preserved = (existing ?? []).filter(
    item => (item.booking_type || 'regular').toLowerCase() !== 'regular',
  )
  const capacity = (existing ?? []).find(item => item.capacity)?.capacity ?? 50

  const rebuilt: ScheduleConfigItem[] = services.map(service => ({
    name: service.name.trim() || 'food service',
    starts_at: service.starts_at,
    ends_at: service.ends_at,
    capacity,
    booking_type: 'regular',
  }))

  return [...preserved, ...rebuilt]
}

/** The editable (regular) services out of a day's schedule_config. */
export function readServiceWindows(existing: ScheduleConfigItem[] | null): ServiceWindowInput[] {
  return (existing ?? [])
    .filter(item => (item.booking_type || 'regular').toLowerCase() === 'regular')
    .map(item => ({
      name: item.name ?? '',
      starts_at: toClock(item.starts_at),
      ends_at: toClock(item.ends_at),
    }))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}
