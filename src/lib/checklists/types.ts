// src/lib/checklists/types.ts
// Shared contracts for the checklists engine. Pure types, no logic. Every engine module
// imports from here so shapes stay consistent. See tasks/checklists-discovery/spec.md v4.

export type ScheduleKind = 'calendar' | 'floating'
export type Anchor = 'open' | 'close' | 'every' | 'at_times' | 'anytime'
export type Freq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
export type InstanceState = 'pending' | 'done' | 'missed' | 'skipped' | 'not_applicable'
export type Band = 'green' | 'amber' | 'red'

/** A row from business_hours or special_hours, only the fields the resolver reads. */
export interface HoursRow {
  opens: string | null
  closes: string | null
  is_closed: boolean | null
}

/** Discriminated result of resolving a day's trading window (spec 5.1). */
export type TradingWindow =
  | { isClosed: true; source: 'special_hours' | 'business_hours' }
  | { isClosed: false; opens: string; closes: string; source: 'special_hours' | 'business_hours' }
  | { resolved: false; reason: 'query_error' | 'no_hours' | 'invalid_hours' }

/** Zoned instants for a day, London-resolved (spec 5.3). */
export interface WindowInstants {
  opensAt: Date
  closesAt: Date
}

/** The cadence-relevant subset of a template (spec 3.2). */
export interface CadenceTemplate {
  scheduleKind: ScheduleKind
  freq: Freq | null
  freqInterval: number
  anchorDate: string | null // 'YYYY-MM-DD'
  byWeekday: number[] | null // 0 = Sunday
  seasonStart: string | null // 'MM-DD'
  seasonEnd: string | null
  intervalDays: number | null
  toleranceDays: number | null
  firstDueOn: string | null // 'YYYY-MM-DD'
}

/** A published rota shift, only the fields accountability needs (spec 6). */
export interface ShiftRow {
  employeeId: string | null
  shiftDate: string // 'YYYY-MM-DD'
  startTime: string // 'HH:MM' or 'HH:MM:SS'
  endTime: string
  department: string
  status: string
  isOpenShift: boolean
}

/** A completed instance for scoring (spec 7). */
export interface ScoredInstance {
  completedAt: Date
  graceUntil: Date
}

/** Result of scoring one person's completed instances. */
export interface TimelinessResult {
  score: number | null // null when suppressed (< 30)
  count: number
  band: Band | null
}
