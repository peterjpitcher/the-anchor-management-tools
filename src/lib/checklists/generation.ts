// src/lib/checklists/generation.ts
// Pure "desired instance set" computation for the checklists engine (spec 4, 5.3, 5.4).
// No I/O: the job (jobs/generate.ts) resolves the window, loads templates and floating
// priors, then hands them here. Given a business date, its zoned open/close instants and the
// relevant settings, this returns exactly the instances that should exist for the date. The
// job reconciles those against the database. All timezone maths goes through date-fns-tz so
// results are DST-correct and identical under any TZ (tests run under TZ=UTC).

import { addMinutes, subMinutes } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { inSeason, isCalendarDueOn, everySlots, nextFloatingDue } from './cadence'
import { businessDayBounds } from './window'
import type { InstanceState } from './types'

const TZ = 'Europe/London'

/** Trim an 'HH:MM' or 'HH:MM:SS' string down to 'HH:MM'. */
function normTime(value: string): string {
  return value.slice(0, 5)
}

/** The template fields generation needs, already mapped to camelCase by the job. */
export interface GenTemplate {
  id: string
  checklistId: string
  version: number
  department: string
  title: string
  instruction: string | null
  scheduleKind: 'calendar' | 'floating'
  anchor: 'open' | 'close' | 'every' | 'at_times' | 'anytime'
  freq: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | null
  freqInterval: number
  anchorDate: string | null
  byWeekday: number[] | null
  seasonStart: string | null
  seasonEnd: string | null
  atTimes: string[] | null
  everyHours: number | null
  firstOffsetMinutes: number | null
  notBefore: string | null
  leadMinutes: number
  graceMinutes: number | null
  intervalDays: number | null
  toleranceDays: number | null
  firstDueOn: string | null
  requiresValue: boolean
  valueUnit: string | null
  valueMin: number | null
  valueMax: number | null
  isSpotCheckable: boolean
}

/** The prior floating instance the recurrence formula reads (spec 4). All dates are business dates. */
export interface FloatingPrior {
  dueDate: string
  state: InstanceState
  completedDate: string | null
  graceDate: string
}

/** One instance that should exist for the date, before reconciliation against the database. */
export interface DesiredInstance {
  templateId: string
  templateVersion: number
  checklistId: string
  slot: string
  department: string
  titleSnapshot: string
  instructionSnapshot: string | null
  requiresValue: boolean
  valueUnit: string | null
  valueMin: number | null
  valueMax: number | null
  isSpotCheckable: boolean
  windowStart: Date
  dueAt: Date
  graceUntil: Date
}

/** Settings subset the computation needs (minutes, hours, all numeric). */
interface GenSettings {
  defaultGraceMinutes: number
  openLeadMinutes: number
  closeLeadMinutes: number
  businessDayStartHour: number
}

/**
 * Compute the desired instance set for a business date (spec 5.4 step 3).
 *
 * Calendar templates out of season are skipped (spec 4). Each remaining template maps to its
 * per-anchor instants (spec 5.3): open/close anchor to the window edges, `every`/`at_times`
 * expand into one instance per slot (`slot = 'HH:MM'` London wall time), `anytime` spans the
 * whole business day. Floating templates use {@link nextFloatingDue}: they generate an
 * `anytime` instance only when the next due date has arrived, with grace spanning the
 * tolerance window. The caller only passes floating templates that have no pending instance.
 */
export function computeDesiredInstances(
  templates: GenTemplate[],
  businessDate: string,
  windowInstants: { opensAt: Date; closesAt: Date },
  settings: GenSettings,
  floatingPriors: Record<string, FloatingPrior | null>,
): DesiredInstance[] {
  const { opensAt, closesAt } = windowInstants
  const out: DesiredInstance[] = []

  for (const t of templates) {
    // Season gate applies to calendar templates only (floating has no season).
    if (t.scheduleKind === 'calendar' && !inSeason(businessDate, t.seasonStart, t.seasonEnd)) {
      continue
    }

    const grace = t.graceMinutes ?? settings.defaultGraceMinutes

    // Fields snapshotted onto every instance this template produces.
    const snapshot = {
      templateId: t.id,
      templateVersion: t.version,
      checklistId: t.checklistId,
      department: t.department,
      titleSnapshot: t.title,
      instructionSnapshot: t.instruction,
      requiresValue: t.requiresValue,
      valueUnit: t.valueUnit,
      valueMin: t.valueMin,
      valueMax: t.valueMax,
      isSpotCheckable: t.isSpotCheckable,
    }

    // --- Floating: anchor is forced 'anytime'; due-ness comes from the recurrence formula ---
    if (t.scheduleKind === 'floating') {
      const prior = floatingPriors[t.id] ?? null
      const nextDue = nextFloatingDue(prior, t.intervalDays ?? 0, t.firstDueOn ?? businessDate)
      if (nextDue <= businessDate) {
        const { start, end } = businessDayBounds(businessDate, settings.businessDayStartHour)
        out.push({
          ...snapshot,
          slot: 'anytime',
          windowStart: start,
          dueAt: end,
          graceUntil: addMinutes(end, (t.toleranceDays ?? 0) * 24 * 60),
        })
      }
      continue
    }

    // --- Calendar: due only when the recurrence lands on the date (season already gated) ---
    if (!isCalendarDueOn(t, businessDate)) {
      continue
    }

    switch (t.anchor) {
      case 'open': {
        const dueAt = opensAt
        out.push({
          ...snapshot,
          slot: 'open',
          windowStart: subMinutes(dueAt, settings.openLeadMinutes),
          dueAt,
          graceUntil: addMinutes(dueAt, grace),
        })
        break
      }

      case 'close': {
        const dueAt = closesAt
        out.push({
          ...snapshot,
          slot: 'close',
          windowStart: subMinutes(dueAt, settings.closeLeadMinutes),
          dueAt,
          graceUntil: addMinutes(dueAt, grace),
        })
        break
      }

      case 'every': {
        const notBefore = t.notBefore
          ? fromZonedTime(`${businessDate}T${normTime(t.notBefore)}:00`, TZ)
          : null
        const slots = everySlots(opensAt, closesAt, t.everyHours ?? 0, {
          firstOffsetMinutes: t.firstOffsetMinutes,
          notBefore,
        })
        for (const slotInstant of slots) {
          out.push({
            ...snapshot,
            slot: formatInTimeZone(slotInstant, TZ, 'HH:mm'),
            windowStart: subMinutes(slotInstant, t.leadMinutes),
            dueAt: slotInstant,
            graceUntil: addMinutes(slotInstant, grace),
          })
        }
        break
      }

      case 'at_times': {
        for (const at of t.atTimes ?? []) {
          const slotInstant = fromZonedTime(`${businessDate}T${normTime(at)}:00`, TZ)
          // Fixed clock times outside the trading window are dropped (spec 5.3).
          if (slotInstant < opensAt || slotInstant > closesAt) continue
          out.push({
            ...snapshot,
            slot: formatInTimeZone(slotInstant, TZ, 'HH:mm'),
            windowStart: subMinutes(slotInstant, t.leadMinutes),
            dueAt: slotInstant,
            graceUntil: addMinutes(slotInstant, grace),
          })
        }
        break
      }

      case 'anytime': {
        const { start, end } = businessDayBounds(businessDate, settings.businessDayStartHour)
        out.push({
          ...snapshot,
          slot: 'anytime',
          windowStart: start,
          dueAt: end,
          graceUntil: end,
        })
        break
      }
    }
  }

  return out
}
