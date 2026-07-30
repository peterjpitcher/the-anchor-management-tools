// Deterministic reminder schedule derivation (spec 5.2, F17/F18).
// Pure function over London calendar date strings (yyyy-mm-dd); all date
// arithmetic uses Date.UTC on the date strings so timezones cannot drift it.
// Callers convert instants to London dates via dateUtils before calling.
//
// Rules implemented (spec 5.2 table + rules, plus decisions recorded below):
// - day30 = issued + 30 London days, created only when expiry is strictly after it.
// - day90 = issued + 90 London days, same condition.
// - pre_expiry = expiry - 14 London days:
//   - when that date is on or before issue (expiry within 14 days of issue) the
//     entry is still returned but always 'skipped', so the outbox records that
//     the milestone was considered and can never send it.
//   - otherwise it is suppressed when an included day30/day90 falls within the
//     7 days up to and including it (a milestone that has just fired makes the
//     pre-expiry nudge redundant). A milestone falling after the pre-expiry
//     date does not suppress it.
// - Milestones scheduled strictly before todayLondon come back 'skipped',
//   never sent late (F36). A milestone scheduled today is still 'pending'.
// - Kinds in alreadySentKinds are never re-emitted (sent milestones are never
//   repeated for the voucher, F36).
// - Cap: sent kinds + returned 'pending' entries never exceed REMINDER_MAX_SENDS.
//   When the cap forces a drop, day90 is dropped first, then day30; pre_expiry
//   is kept preferentially (the final warning is only dropped when two other
//   milestones were already sent, i.e. the budget is zero). Dropped entries are
//   omitted from the result entirely. 'skipped' entries never count toward the
//   cap. This matches the DB recompute in migration 20260802000002.
// - Result is sorted by scheduledFor ascending, then kind order.

import { PRE_EXPIRY_LEAD_DAYS, REMINDER_MAX_SENDS } from './constants'
import type { ReminderKind } from '@/types/vouchers'

const PRE_EXPIRY_PROXIMITY_DAYS = 7
const MS_PER_DAY = 86_400_000
const KIND_ORDER: Record<ReminderKind, number> = { day30: 0, day90: 1, pre_expiry: 2 }
// Cap keep-priority: pre_expiry is kept first, day90 is dropped first
const CAP_KEEP_PRIORITY: Record<ReminderKind, number> = { pre_expiry: 0, day30: 1, day90: 2 }

export interface ReminderScheduleInput {
  issuedAtLondonDate: string
  expiryDate: string
  alreadySentKinds: ReminderKind[]
  todayLondon: string
}

export interface ReminderScheduleEntry {
  kind: ReminderKind
  scheduledFor: string
  initialStatus: 'pending' | 'skipped'
}

function isoDateToUtcMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function addDays(isoDate: string, days: number): string {
  const shifted = new Date(isoDateToUtcMs(isoDate) + days * MS_PER_DAY)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function diffDays(fromIsoDate: string, toIsoDate: string): number {
  return Math.round((isoDateToUtcMs(toIsoDate) - isoDateToUtcMs(fromIsoDate)) / MS_PER_DAY)
}

function compareEntries(a: ReminderScheduleEntry, b: ReminderScheduleEntry): number {
  if (a.scheduledFor !== b.scheduledFor) return a.scheduledFor < b.scheduledFor ? -1 : 1
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
}

export function deriveReminderSchedule(input: ReminderScheduleInput): ReminderScheduleEntry[] {
  const { issuedAtLondonDate, expiryDate, alreadySentKinds, todayLondon } = input
  const sentKinds = new Set<ReminderKind>(alreadySentKinds)

  const candidates: Array<{ kind: ReminderKind; scheduledFor: string; forceSkipped: boolean }> = []

  const milestoneDates: string[] = []
  const day30Date = addDays(issuedAtLondonDate, 30)
  if (day30Date < expiryDate) {
    candidates.push({ kind: 'day30', scheduledFor: day30Date, forceSkipped: false })
    milestoneDates.push(day30Date)
  }
  const day90Date = addDays(issuedAtLondonDate, 90)
  if (day90Date < expiryDate) {
    candidates.push({ kind: 'day90', scheduledFor: day90Date, forceSkipped: false })
    milestoneDates.push(day90Date)
  }

  const preExpiryDate = addDays(expiryDate, -PRE_EXPIRY_LEAD_DAYS)
  if (preExpiryDate <= issuedAtLondonDate) {
    candidates.push({ kind: 'pre_expiry', scheduledFor: preExpiryDate, forceSkipped: true })
  } else {
    const covered = milestoneDates.some(milestoneDate => {
      const gap = diffDays(milestoneDate, preExpiryDate)
      return gap >= 0 && gap <= PRE_EXPIRY_PROXIMITY_DAYS
    })
    if (!covered) {
      candidates.push({ kind: 'pre_expiry', scheduledFor: preExpiryDate, forceSkipped: false })
    }
  }

  const entries: ReminderScheduleEntry[] = candidates
    .filter(candidate => !sentKinds.has(candidate.kind))
    .map(candidate => ({
      kind: candidate.kind,
      scheduledFor: candidate.scheduledFor,
      initialStatus:
        candidate.forceSkipped || candidate.scheduledFor < todayLondon ? 'skipped' : 'pending',
    }))

  const sendBudget = Math.max(0, REMINDER_MAX_SENDS - sentKinds.size)
  const pendingKept = new Set(
    entries
      .filter(entry => entry.initialStatus === 'pending')
      .sort((a, b) => CAP_KEEP_PRIORITY[a.kind] - CAP_KEEP_PRIORITY[b.kind])
      .slice(0, sendBudget)
  )

  return entries
    .filter(entry => entry.initialStatus === 'skipped' || pendingKept.has(entry))
    .sort(compareEntries)
}
