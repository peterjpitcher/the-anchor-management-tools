import { addMonthsToIsoDate } from '@/lib/dateUtils'
import { daysBetween } from './dates'
import {
  OPEN_ASSIGNMENT_STATUSES,
  TRAINING_INTRO_KEY,
  TrainingError,
  type AssignmentProgress,
  type OpenAssignmentStatus,
  type PlayerSectionState,
  type SectionProgress,
  type TrainingAssignment,
  type TrainingAssignmentStatus,
  type TrainingDisplayState,
} from './types'

/**
 * Display states and progress rules (build contract section 3, "Display state" and "Checks").
 * Pure: no clock, no database; `today` is a London date passed in. Progress helpers never change
 * the object they are given; each returns a new one.
 */

/** A section locks on its third failed check. */
export const MAX_SECTION_FAILS = 3

/** "Due soon" starts this many days before the due date (display and the due_soon reminder). */
export const DUE_SOON_DAYS = 2

/** The assignment fields the display state reads. */
export type AssignmentStateFields = Pick<
  TrainingAssignment,
  'id' | 'cycle' | 'status' | 'dueOn' | 'startedAt' | 'completedOn' | 'expiresOn' | 'windowOpensOn'
>

const OPEN_STATUS_SET: ReadonlySet<string> = new Set(OPEN_ASSIGNMENT_STATUSES)

/** True for waiting, assigned, in_progress, locked, awaiting_confirmation and declined. */
export function isOpenStatus(status: TrainingAssignmentStatus): status is OpenAssignmentStatus {
  return OPEN_STATUS_SET.has(status)
}

/** Whole days `dueOn` is past `today` (1 the day after), or null when not overdue or no due date. */
export function daysOverdue(dueOn: string | null, today: string): number | null {
  if (dueOn === null) return null
  const days = daysBetween(dueOn, today)
  return days > 0 ? days : null
}

function byCycleDescending<T extends { cycle: number }>(a: T, b: T): number {
  return b.cycle - a.cycle
}

function isExpired(assignment: Pick<AssignmentStateFields, 'expiresOn'>, today: string): boolean {
  return assignment.expiresOn !== null && assignment.expiresOn < today
}

/**
 * What one person's course shows. `assignments` are every cycle of that person on that course,
 * any order; the open cycle (at most one) and the latest completed cycle are picked from them.
 * First match wins, exactly as the contract lists:
 *
 * `not_required` (no cycle other than cancelled ones, and the course does not apply) / `paused` (`paused`
 * and a cycle is open) / `locked` / `declined` / `awaiting_confirmation` / `waiting` / `overdue`
 * (open, dueOn before today) / `due_soon` (open, due within DUE_SOON_DAYS) / `in_progress` (open,
 * started) / `not_started` (open, or no cycle yet but the course applies) / `waived` (latest cycle
 * waived) / `expired` (latest completed, expiresOn before today) / `refresher_due` (latest
 * completed, today on or after windowOpensOn) / `done`.
 *
 * Validity is decided by expiry alone (spec 4.3). So while a cycle is open (a refresher, a redo or
 * a manual cycle) and the latest completed cycle's expiry has passed, the item shows `expired`
 * instead of waiting, overdue, due soon, in progress or not started; the screens add the open
 * cycle's due date ("Expired (due 1 Dec 2026)"). Paused, locked, declined and awaiting
 * confirmation still show as themselves, because each needs someone to act.
 *
 * One refinement for a course that no longer applies (a group removed, an age rule passed) and
 * has no open cycle: a completion still in date shows `done`, and one that has expired or is
 * inside its refresher window shows `not_required`, because nothing is owed and sync will not
 * open a refresher for it.
 *
 * And one for a course with a prerequisite (spec 4.1: a practical sign-off "counts as done only
 * while the course it depends on is valid"). With no open cycle, a completion still in date whose
 * prerequisite is no longer valid shows `waiting` ("Waiting for prerequisite"), not `done` or
 * `refresher_due`, because it stops counting until the prerequisite is done again. Its own expiry
 * still comes first, and a course that no longer applies shows `not_required` instead.
 */
export function displayStateFor(input: {
  assignments: readonly AssignmentStateFields[]
  /** Whether the course applies to this person today (sync.ts `courseAppliesTo`). */
  applies: boolean
  /** Whether the person's training is paused today (`isPausedOn`). */
  paused: boolean
  /**
   * Whether the course's prerequisite is met today (`prerequisiteMet`). Always true for a course
   * with no prerequisite; leaving it out means true.
   */
  prerequisiteValid?: boolean
  today: string
}): TrainingDisplayState {
  const { applies, paused, today } = input
  const prerequisiteLapsed = input.prerequisiteValid === false
  const kept = input.assignments.filter((assignment) => assignment.status !== 'cancelled')
  if (kept.length === 0) return applies ? 'not_started' : 'not_required'

  const open = kept.filter((assignment) => isOpenStatus(assignment.status)).sort(byCycleDescending)[0]
  if (open) {
    if (paused) return 'paused'
    if (open.status === 'locked') return 'locked'
    if (open.status === 'declined') return 'declined'
    if (open.status === 'awaiting_confirmation') return 'awaiting_confirmation'
    const lastCompleted = kept.filter((assignment) => assignment.status === 'completed').sort(byCycleDescending)[0]
    if (lastCompleted && isExpired(lastCompleted, today)) return 'expired'
    if (open.status === 'waiting') return 'waiting'
    if (open.dueOn !== null) {
      const daysLeft = daysBetween(today, open.dueOn)
      if (daysLeft < 0) return 'overdue'
      if (daysLeft <= DUE_SOON_DAYS) return 'due_soon'
    }
    if (open.status === 'in_progress' || open.startedAt !== null) return 'in_progress'
    return 'not_started'
  }

  const latest = [...kept].sort(byCycleDescending)[0]
  if (latest.status === 'waived') return 'waived'
  if (latest.status !== 'completed') return applies ? 'not_started' : 'not_required'

  const expired = isExpired(latest, today)
  const windowOpen = latest.windowOpensOn !== null && today >= latest.windowOpensOn
  if (!applies) return expired || windowOpen || prerequisiteLapsed ? 'not_required' : 'done'
  if (expired) return 'expired'
  if (prerequisiteLapsed) return 'waiting'
  if (windowOpen) return 'refresher_due'
  return 'done'
}

/**
 * The cycle a matrix cell or record line describes: the open cycle, else the latest by cycle
 * number that is not cancelled, else null.
 */
export function pickDisplayAssignment<T extends AssignmentStateFields>(assignments: readonly T[]): T | null {
  const kept = assignments.filter((assignment) => assignment.status !== 'cancelled').sort(byCycleDescending)
  return kept.find((assignment) => isOpenStatus(assignment.status)) ?? kept[0] ?? null
}

/**
 * Whether a valid completion is held today (completed, and not expired). Reads only the status
 * and expiry, so sync's slimmer cycles can be passed too. A waiver never counts here; see
 * `trainingCurrent` for the prerequisite check, where a waived refresher covers one period.
 */
export function hasValidCompletion(assignments: readonly Pick<AssignmentStateFields, 'status' | 'expiresOn'>[], today: string): boolean {
  return assignments.some((assignment) => assignment.status === 'completed' && !isExpired(assignment, today))
}

/**
 * The expiry a person's training on a course runs to before cycle `beforeCycle`, which is what a
 * new completion extends from (`computeExpiresOn`): the latest completed cycle's expiry, moved on
 * one refresher period for each refresher or renewal waived after it (owner decision, 3 November
 * 2026: a waiver covers one refresher period only). Null when there is no earlier completion with
 * an expiry. Pass the cycles of one course only.
 */
export function expiryToExtendFrom(
  cycles: ReadonlyArray<Pick<TrainingAssignment, 'cycle' | 'status' | 'reason' | 'expiresOn'>>,
  beforeCycle: number,
  refresherMonths: number | null
): string | null {
  const earlier = cycles.filter((cycle) => cycle.cycle < beforeCycle)
  const completed = earlier.filter((cycle) => cycle.status === 'completed').sort((a, b) => b.cycle - a.cycle)[0]
  if (!completed?.expiresOn) return null
  if (refresherMonths === null) return completed.expiresOn
  const waivedPeriods = earlier.filter(
    (cycle) => cycle.cycle > completed.cycle && cycle.status === 'waived' && (cycle.reason === 'refresher' || cycle.reason === 'renewal')
  ).length
  if (waivedPeriods === 0) return completed.expiresOn
  return addMonthsToIsoDate(completed.expiresOn, refresherMonths * waivedPeriods)
}

/**
 * Whether a person's training on one course is current today: a completion still in date
 * (`hasValidCompletion`), or the latest completion's expiry moved on one refresher period for
 * each refresher or renewal waived since (`expiryToExtendFrom`) not yet passed. A waived
 * refresher covers one period (owner decision, 3 November 2026), so for that period the course
 * still counts as done for anything that needs it. A waived first cycle, redo or manual cycle
 * covers nothing. Pass the cycles of one course only.
 */
export function trainingCurrent(
  cycles: ReadonlyArray<Pick<TrainingAssignment, 'cycle' | 'status' | 'reason' | 'expiresOn'>>,
  refresherMonths: number | null,
  today: string
): boolean {
  if (hasValidCompletion(cycles, today)) return true
  const coveredTo = expiryToExtendFrom(cycles, Number.POSITIVE_INFINITY, refresherMonths)
  return coveredTo !== null && coveredTo >= today
}

/**
 * The course a prerequisite check reads: its id, and the months a completion of it lasts, which
 * a waived refresher of it covers once (`trainingCurrent`).
 */
export interface PrerequisiteCourse {
  id: string
  /** Months a completion lasts, or null when it never expires. */
  refresherMonths: number | null
}

/**
 * The prerequisite of `course` for `prerequisiteMet`, or null when it has none. Its refresher
 * months are read from `courseById`; a prerequisite missing from it is read as never extended
 * by a waiver, which can only make the check stricter.
 */
export function prerequisiteOf(
  course: { prerequisiteCourseId: string | null },
  courseById: ReadonlyMap<string, { refresherMonths: number | null }>
): PrerequisiteCourse | null {
  if (course.prerequisiteCourseId === null) return null
  return { id: course.prerequisiteCourseId, refresherMonths: courseById.get(course.prerequisiteCourseId)?.refresherMonths ?? null }
}

/**
 * Whether a course's prerequisite is met today (spec 4.1): always for a course with none, else
 * whether the person's training on the prerequisite course is current (`trainingCurrent`: a
 * valid completion, or a waived refresher still inside the period it covers). `assignments` may
 * be the person's cycles on every course; only those on the prerequisite are read.
 */
export function prerequisiteMet(
  prerequisite: PrerequisiteCourse | null,
  assignments: readonly Pick<TrainingAssignment, 'courseId' | 'cycle' | 'status' | 'reason' | 'expiresOn'>[],
  today: string
): boolean {
  if (prerequisite === null) return true
  return trainingCurrent(
    assignments.filter((assignment) => assignment.courseId === prerequisite.id),
    prerequisite.refresherMonths,
    today
  )
}

/**
 * Whether a course counts as done today, for completion rates: a valid completion of the course
 * and, for a course with a prerequisite, that prerequisite still met (`prerequisiteMet`, spec
 * 4.1). `assignments` are the person's cycles on this course.
 */
export function countsAsDone(input: {
  assignments: readonly Pick<AssignmentStateFields, 'status' | 'expiresOn'>[]
  /** `prerequisiteMet` for this course; leaving it out means true. */
  prerequisiteValid?: boolean
  today: string
}): boolean {
  return input.prerequisiteValid !== false && hasValidCompletion(input.assignments, input.today)
}

/** Whether a profile's pause covers `today` (pausedFrom on or before today, pausedUntil null or on or after today). */
export function isPausedOn(profile: { pausedFrom: string | null; pausedUntil: string | null } | null, today: string): boolean {
  if (!profile || profile.pausedFrom === null) return false
  if (profile.pausedFrom > today) return false
  return profile.pausedUntil === null || profile.pausedUntil >= today
}

function isPassed(progress: AssignmentProgress, sectionKey: string): boolean {
  return Boolean(progress.sections?.[sectionKey]?.passedAt)
}

function sectionOf(progress: AssignmentProgress, sectionKey: string): SectionProgress {
  const existing = progress.sections?.[sectionKey]
  return {
    card: existing?.card ?? 0,
    fails: existing?.fails ?? 0,
    passedAt: existing?.passedAt ?? null,
    lastAttemptQuestionIds: [...(existing?.lastAttemptQuestionIds ?? [])],
  }
}

function withSection(progress: AssignmentProgress, sectionKey: string, section: SectionProgress, current?: string | null): AssignmentProgress {
  return {
    sections: { ...(progress.sections ?? {}), [sectionKey]: section },
    current: current === undefined ? progress.current ?? null : current,
    introSeen: Boolean(progress.introSeen),
  }
}

/**
 * Where each section stands for the learner, in course order: `passed`; `locked` (the
 * assignment's `lockedSection`); `open` (the first section not passed, when every earlier one
 * is passed); `not_open` (later sections).
 */
export function sectionStatesFor(
  progress: AssignmentProgress,
  sectionKeys: readonly string[],
  lockedSection: string | null
): Record<string, PlayerSectionState> {
  const states: Record<string, PlayerSectionState> = {}
  let reachedFirstUnpassed = false
  for (const key of sectionKeys) {
    if (isPassed(progress, key)) {
      states[key] = 'passed'
    } else if (key === lockedSection) {
      states[key] = 'locked'
      reachedFirstUnpassed = true
    } else if (!reachedFirstUnpassed) {
      states[key] = 'open'
      reachedFirstUnpassed = true
    } else {
      states[key] = 'not_open'
    }
  }
  return states
}

/** The first section not yet passed, in course order, or null when all are passed. */
export function nextSectionKey(progress: AssignmentProgress, sectionKeys: readonly string[]): string | null {
  return sectionKeys.find((key) => !isPassed(progress, key)) ?? null
}

/** Whether every section is passed. */
export function allSectionsPassed(progress: AssignmentProgress, sectionKeys: readonly string[]): boolean {
  return sectionKeys.every((key) => isPassed(progress, key))
}

/**
 * Progress after the learner reaches `card` in `sectionKey` (saved on each Next). Refuses (throws a
 * TrainingError 'not_allowed') a section that is not open. Never moves `card` past the section's
 * last card index (`cardCount - 1`).
 *
 * Details: the stored card is the furthest reached, so going Back to look again never loses the
 * place. A section already passed may be looked at again; that saves nothing. `TRAINING_INTRO_KEY`
 * records the intro as seen once its last card (`cardCount - 1`) is reached.
 */
export function withCardReached(
  progress: AssignmentProgress,
  input: { sectionKeys: readonly string[]; sectionKey: string; card: number; cardCount: number }
): AssignmentProgress {
  const { sectionKeys, sectionKey, card, cardCount } = input
  if (!Number.isInteger(card) || card < 0 || !Number.isInteger(cardCount) || cardCount < 0) {
    throw new TrainingError('invalid', 'That card is not part of this course.')
  }
  const lastCard = Math.max(cardCount - 1, 0)

  if (sectionKey === TRAINING_INTRO_KEY) {
    return {
      sections: { ...(progress.sections ?? {}) },
      current: progress.current ?? null,
      introSeen: Boolean(progress.introSeen) || card >= lastCard,
    }
  }

  if (!sectionKeys.includes(sectionKey)) {
    throw new TrainingError('not_allowed', 'That section is not part of this course.')
  }
  if (isPassed(progress, sectionKey)) {
    return withSection(progress, sectionKey, sectionOf(progress, sectionKey))
  }
  if (nextSectionKey(progress, sectionKeys) !== sectionKey) {
    throw new TrainingError('not_allowed', 'Finish the sections before this one first.')
  }

  const section = sectionOf(progress, sectionKey)
  section.card = Math.max(section.card, Math.min(card, lastCard))
  return withSection(progress, sectionKey, section, sectionKey)
}

/** Progress after a passed check: `passedAt` set, `current` moved to the next section. */
export function withSectionPassed(
  progress: AssignmentProgress,
  input: { sectionKeys: readonly string[]; sectionKey: string; passedAt: string; questionIds: readonly string[] }
): AssignmentProgress {
  const { sectionKeys, sectionKey, passedAt, questionIds } = input
  if (!sectionKeys.includes(sectionKey) || nextSectionKey(progress, sectionKeys) !== sectionKey) {
    throw new TrainingError('not_allowed', 'That section is not open.')
  }
  const section = sectionOf(progress, sectionKey)
  section.passedAt = passedAt
  section.lastAttemptQuestionIds = [...questionIds]
  const passed = withSection(progress, sectionKey, section)
  // When every section is passed the learner stays on the last one (the finish screen).
  passed.current = nextSectionKey(passed, sectionKeys) ?? sectionKey
  return passed
}

/**
 * Progress after a failed check: the section's fail count goes up, the learner goes back to card
 * 0 of that section, and the served question ids are kept for the next draw. `locked` is true on
 * the MAX_SECTION_FAILS-th fail; the caller then sets the assignment `locked`.
 */
export function withSectionFailed(
  progress: AssignmentProgress,
  input: { sectionKey: string; questionIds: readonly string[] }
): { progress: AssignmentProgress; fails: number; locked: boolean } {
  const { sectionKey, questionIds } = input
  if (isPassed(progress, sectionKey)) {
    throw new TrainingError('not_allowed', 'That section is already passed.')
  }
  const section = sectionOf(progress, sectionKey)
  section.fails += 1
  section.card = 0
  section.lastAttemptQuestionIds = [...questionIds]
  return {
    progress: withSection(progress, sectionKey, section, sectionKey),
    fails: section.fails,
    locked: section.fails >= MAX_SECTION_FAILS,
  }
}

/** Progress after a manager unlocks a section: its fail count back to 0, card back to 0. */
export function withSectionUnlocked(progress: AssignmentProgress, sectionKey: string): AssignmentProgress {
  const section = sectionOf(progress, sectionKey)
  section.fails = 0
  section.card = 0
  return withSection(progress, sectionKey, section)
}
