// Deterministic reminder schedule derivation (spec 5.2, F17/F18).
// Pure function over London calendar date strings (yyyy-mm-dd); all date
// arithmetic uses Date.UTC on the date parts so British Summer Time cannot
// drift a target by a day. Callers convert instants to London dates via
// dateUtils before calling.
//
// Cadence: two reminders per voucher, both counted back from the expiry date,
// at 7 days and 3 days before it. Vouchers are normally valid for one month
// from issue, so milestones counted forward from issue were almost never
// reached, which is why the day-30 and day-90 rules were dropped.
//
// Rules implemented:
// - Targets are expiry - 7 and expiry - 3 London days.
// - A target on or after todayLondon is 'pending'.
// - A target already in the past comes back 'skipped', so the outbox records
//   that the milestone was considered and it can never be sent late (F36).
// - Kinds in alreadySentKinds are never re-emitted (F36).
// - The REMINDER_MAX_SENDS cap of 2 is structural rather than enforced here:
//   there are only two kinds and a sent kind is never re-emitted, so sent plus
//   pending can never exceed 2.
// - Result is sorted by scheduledFor ascending, so pre_expiry_7 comes first.
//
// This mirrors public.voucher_reminders_recompute (migration 20260802000003).

import { REMINDER_LEAD_DAYS } from './constants'
import type { ReminderKind } from '@/types/vouchers'

const MS_PER_DAY = 86_400_000

type ReminderLeadDays = (typeof REMINDER_LEAD_DAYS)[number]

export interface ReminderScheduleInput {
  // Kept for the call signature and audit parity. The cadence counts back from
  // expiry only, so the issue date no longer affects the result.
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

// The kind name carries its own lead time, so the constant and the union stay
// in lockstep: change REMINDER_LEAD_DAYS and this stops compiling until
// ReminderKind matches.
function kindForLeadDays(leadDays: ReminderLeadDays): ReminderKind {
  return `pre_expiry_${leadDays}`
}

export function deriveReminderSchedule(input: ReminderScheduleInput): ReminderScheduleEntry[] {
  const { expiryDate, alreadySentKinds, todayLondon } = input
  const sentKinds = new Set<ReminderKind>(alreadySentKinds)

  return REMINDER_LEAD_DAYS.map(leadDays => ({
    kind: kindForLeadDays(leadDays),
    scheduledFor: addDays(expiryDate, -leadDays),
  }))
    .filter(candidate => !sentKinds.has(candidate.kind))
    .map(candidate => ({
      kind: candidate.kind,
      scheduledFor: candidate.scheduledFor,
      initialStatus:
        candidate.scheduledFor < todayLondon ? ('skipped' as const) : ('pending' as const),
    }))
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : a.scheduledFor > b.scheduledFor ? 1 : 0))
}
