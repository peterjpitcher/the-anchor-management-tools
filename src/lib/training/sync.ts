import { shiftIsoDate } from '@/lib/dateUtils'
import {
  PREREQUISITE_DUE_DAYS,
  REDO_DUE_DAYS,
  ageOn,
  computeInitialDueOn,
  isNewStarter,
  refresherDueOn,
  resumeDueOn,
} from './dates'
import { isOpenStatus, prerequisiteMet } from './states'
import {
  TRAINING_GROUPS,
  TrainingError,
  type SyncResult,
  type TrainingAssignment,
  type TrainingAssignmentReason,
  type TrainingAudienceAge,
  type TrainingCancelReason,
  type TrainingCourseKind,
  type TrainingCourseStatus,
  type TrainingEmployeeStatus,
  type TrainingGroup,
  type TrainingProfile,
} from './types'

/**
 * Who gets what (build contract section 3, "Who gets what"). `planAssignmentSync` is pure: it
 * reads a snapshot and returns the changes to make; `TrainingService.syncAssignments` loads the
 * snapshot, applies the actions, and writes an event for each.
 */

/** A person as sync sees them. */
export interface SyncEmployee {
  employeeId: string
  status: TrainingEmployeeStatus
  employmentStartDate: string | null
  dateOfBirth: string | null
  jobTitle: string | null
  /** Rota departments worked in the last 90 days (bar, kitchen, runner, host, cleaning, training). */
  recentRotaDepartments: string[]
}

/** A cycle as sync sees it, with the number of the version it was taken on. */
export type SyncAssignment = Pick<
  TrainingAssignment,
  'id' | 'courseId' | 'cycle' | 'status' | 'reason' | 'dueOn' | 'completedOn' | 'expiresOn' | 'windowOpensOn' | 'versionId'
> & {
  /** The version taken, for the redo rule; null before the first start. */
  versionNumber: { major: number; minor: number } | null
}

export interface SyncPerson {
  employee: SyncEmployee
  profile: TrainingProfile | null
  /** Every cycle this person has, on every course. */
  assignments: SyncAssignment[]
}

/** A course as sync sees it. Live and retired courses are both passed, so retired ones can be cancelled. */
export interface SyncCourse {
  id: string
  slug: string
  kind: TrainingCourseKind
  status: TrainingCourseStatus
  audienceGroups: TrainingGroup[]
  audienceAge: TrainingAudienceAge
  isEssentials: boolean
  prerequisiteCourseId: string | null
  newStarterDueDays: number | null
  existingStaffDueDays: number | null
  /** London date of the first publish, to tell `course_added` from `existing_staff`. Null before it. */
  wentLiveOn: string | null
  /**
   * Whether sync assigns this course to its audience. True for online and practical courses. For
   * an external qualification it is the `required` choice made in `createExternalCourse`; one that
   * is not required is only ever recorded by hand.
   */
  assignAutomatically: boolean
  /** The newest published version with `redo_required`, or null. */
  latestRedoVersion: { id: string; major: number; minor: number } | null
}

export interface SyncInput {
  /** London date. */
  today: string
  people: SyncPerson[]
  courses: SyncCourse[]
}

/** One change `syncAssignments` makes. */
export type SyncAction =
  /** A new cycle. `waiting` (prerequisite not met) always has no due date. */
  | {
      type: 'create'
      employeeId: string
      courseId: string
      cycle: number
      reason: TrainingAssignmentReason
      status: 'waiting' | 'assigned'
      assignedOn: string
      dueOn: string | null
    }
  /** An open cycle closed: the person left, left the audience, or the course was retired. */
  | { type: 'cancel'; assignmentId: string; employeeId: string; courseId: string; reason: TrainingCancelReason }
  /** A waiting cycle whose prerequisite is now valid: status `assigned`, due today + 14 (or none). */
  | { type: 'release'; assignmentId: string; employeeId: string; courseId: string; dueOn: string | null }
  /**
   * A pause that has run its course (`pausedUntil` before today): the profile's pause is cleared
   * and each open cycle's due date becomes `resumeDueOn(dueOn, resumedOn)`, with
   * `resumedOn = pausedUntil + 1 day`.
   */
  | { type: 'end_pause'; employeeId: string; resumedOn: string; dueChanges: Array<{ assignmentId: string; dueOn: string | null }> }
  /** An age-restricted course not assigned because the date of birth is missing. */
  | { type: 'flag'; employeeId: string; courseId: string; flag: 'dob_missing' }

/** Which words in a job title suggest which group (spec 4.2). */
const JOB_TITLE_RULES: ReadonlyArray<{ group: TrainingGroup; pattern: RegExp }> = [
  { group: 'bar', pattern: /\bbartenders?\b|\bbar ?staff\b/ },
  { group: 'kitchen', pattern: /\bcooks?\b|\bchefs?\b/ },
  { group: 'floor', pattern: /\bhosts?\b|\brunners?\b/ },
]

/** Which rota departments suggest which group. Cleaning and training suggest none. */
const ROTA_DEPARTMENT_GROUPS: Readonly<Record<string, TrainingGroup>> = {
  bar: 'bar',
  kitchen: 'kitchen',
  runner: 'floor',
  host: 'floor',
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function inFixedOrder(groups: Iterable<TrainingGroup>): TrainingGroup[] {
  const wanted = new Set(groups)
  return TRAINING_GROUPS.filter((group) => wanted.has(group))
}

/**
 * Groups suggested from the job title and recent rota departments (spec 4.2): Bartender or Bar
 * Staff to bar, Cook or Chef to kitchen, Host or Runner to floor; rota departments bar to bar,
 * kitchen to kitchen, runner and host to floor. Case and spacing do not matter. Fixed order, no
 * duplicates. Management is never suggested; a manager confirms it.
 */
export function suggestTrainingGroups(input: { jobTitle: string | null; recentRotaDepartments: readonly string[] }): TrainingGroup[] {
  const suggested = new Set<TrainingGroup>()
  const title = normalise(input.jobTitle ?? '')
  for (const rule of JOB_TITLE_RULES) if (rule.pattern.test(title)) suggested.add(rule.group)
  for (const department of input.recentRotaDepartments ?? []) {
    const group = ROTA_DEPARTMENT_GROUPS[normalise(department)]
    if (group) suggested.add(group)
  }
  return inFixedOrder(suggested)
}

/**
 * The groups training uses for a person: confirmed groups once a manager has confirmed them
 * (`groupsConfirmedAt` set, even when the list is empty), else the suggested ones.
 */
export function effectiveTrainingGroups(
  profile: Pick<TrainingProfile, 'groups' | 'groupsConfirmedAt'> | null,
  suggested: readonly TrainingGroup[]
): { groups: TrainingGroup[]; confirmed: boolean } {
  if (profile?.groupsConfirmedAt) return { groups: inFixedOrder(profile.groups ?? []), confirmed: true }
  return { groups: inFixedOrder(suggested), confirmed: false }
}

/**
 * Whether a course applies to a person today: the course is live, the person's groups meet the
 * course's groups (empty = everyone), and the age rule matches. A missing date of birth means an
 * age-restricted course does not apply and `dobMissing` is true. The group rule is checked first,
 * so `dobMissing` is only raised for a course the person would otherwise get.
 */
export function courseAppliesTo(
  course: Pick<SyncCourse, 'status' | 'audienceGroups' | 'audienceAge'>,
  person: { groups: readonly TrainingGroup[]; dateOfBirth: string | null },
  today: string
): { applies: boolean; dobMissing: boolean } {
  if (course.status !== 'live') return { applies: false, dobMissing: false }
  const audience = course.audienceGroups ?? []
  if (audience.length > 0 && !audience.some((group) => person.groups.includes(group))) {
    return { applies: false, dobMissing: false }
  }
  if (course.audienceAge === 'all') return { applies: true, dobMissing: false }
  const age = ageOn(person.dateOfBirth, today)
  if (age === null) return { applies: false, dobMissing: true }
  return { applies: course.audienceAge === 'under_18' ? age < 18 : age >= 18, dobMissing: false }
}

function isNewer(a: { major: number; minor: number }, b: { major: number; minor: number }): boolean {
  return a.major > b.major || (a.major === b.major && a.minor > b.minor)
}

function addDays(isoDate: string, days: number): string {
  const moved = shiftIsoDate(isoDate, days)
  if (moved === null) throw new TrainingError('invalid', `Cannot move ${isoDate} by ${days} days`)
  return moved
}

/** The reason for a first cycle (contract section 3, "No assignment yet"). */
function firstCycleReason(employee: SyncEmployee, course: SyncCourse, today: string): TrainingAssignmentReason {
  if (isNewStarter(employee.employmentStartDate, today)) return 'new_starter'
  const start = employee.employmentStartDate
  if (start && course.wentLiveOn && course.wentLiveOn > start) return 'course_added'
  return 'existing_staff'
}

/**
 * The changes that bring every person's cycles in line with the rules (contract section 3):
 * scope (Active new and existing; Started Separation open cycles only; everyone else cancelled
 * as `left`), first cycles with their reason and due date (`computeInitialDueOn`), prerequisites
 * (`waiting`, then `release`), refreshers (`refresher`, or `renewal` for external courses, due
 * `max(expiresOn, today)` once today reaches `windowOpensOn`), redo cycles (due today + 14),
 * cancelling for a retired course or a person no longer in the audience, ending pauses, and the
 * date of birth flag. Completed records are never touched. At most one open cycle per person and
 * course, ever. Deterministic: the same input gives the same actions in the same order.
 *
 * Order: people as given; for each, `end_pause` first (when due), then each course as given
 * (cancel, release, create or flag).
 *
 * Choices this makes where the contract is silent:
 * - A `manual` cycle stays open when the person is outside the course's audience: a manager chose
 *   it. It is still cancelled when the person leaves or the course is retired.
 * - An open cycle on an age-restricted course is left alone when the date of birth goes missing;
 *   the person is flagged instead, so a data slip never throws away progress.
 * - When a redo and a refresher are both owed, the redo is created (due today + 14); finishing it
 *   on or before the old expiry extends from that expiry, so nothing is lost.
 * - Any new cycle whose prerequisite is not valid starts `waiting`. A release is due today + 14
 *   when the course has any due date rule, else it has none.
 * - Courses in `draft` are ignored. A course that is not assigned automatically gets no new
 *   cycles, but its open ones are still cancelled for the same reasons as any other.
 */
export function planAssignmentSync(input: SyncInput): SyncAction[] {
  const { today, people, courses } = input
  if (!shiftIsoDate(today, 0)) throw new TrainingError('invalid', `Today is not a real date: ${String(today)}`)
  const actions: SyncAction[] = []

  for (const person of people) {
    const { employee, profile } = person
    const employeeId = employee.employeeId
    const openCycles = person.assignments.filter((assignment) => isOpenStatus(assignment.status))

    // Out of scope (Onboarding, Former): every open cycle is cancelled as left.
    if (employee.status !== 'Active' && employee.status !== 'Started Separation') {
      for (const assignment of [...openCycles].sort(byCourseThenCycle(courses))) {
        actions.push({ type: 'cancel', assignmentId: assignment.id, employeeId, courseId: assignment.courseId, reason: 'left' })
      }
      continue
    }

    const suggested = suggestTrainingGroups({ jobTitle: employee.jobTitle, recentRotaDepartments: employee.recentRotaDepartments })
    const { groups } = effectiveTrainingGroups(profile, suggested)
    const personActions: SyncAction[] = []
    // Open cycles this run closes or re-dates itself, so the pause change leaves them alone.
    const handled = new Set<string>()

    for (const course of courses) {
      if (course.status === 'draft') continue
      const cycles = person.assignments.filter((assignment) => assignment.courseId === course.id)
      const open = cycles.filter((assignment) => isOpenStatus(assignment.status)).sort((a, b) => b.cycle - a.cycle)[0]

      if (course.status === 'retired') {
        if (open) {
          personActions.push({ type: 'cancel', assignmentId: open.id, employeeId, courseId: course.id, reason: 'course_retired' })
          handled.add(open.id)
        }
        continue
      }

      const { applies, dobMissing } = courseAppliesTo(course, { groups, dateOfBirth: employee.dateOfBirth }, today)
      if (dobMissing) personActions.push({ type: 'flag', employeeId, courseId: course.id, flag: 'dob_missing' })

      if (!applies) {
        if (open && !dobMissing && open.reason !== 'manual') {
          personActions.push({ type: 'cancel', assignmentId: open.id, employeeId, courseId: course.id, reason: 'group_removed' })
          handled.add(open.id)
        }
        continue
      }

      const prerequisiteValid = prerequisiteMet(course.prerequisiteCourseId, person.assignments, today)

      if (open) {
        if (open.status === 'waiting' && prerequisiteValid) {
          const hasDueRule = course.newStarterDueDays !== null || course.existingStaffDueDays !== null
          personActions.push({
            type: 'release',
            assignmentId: open.id,
            employeeId,
            courseId: course.id,
            dueOn: hasDueRule ? addDays(today, PREREQUISITE_DUE_DAYS) : null,
          })
          handled.add(open.id)
        }
        continue
      }

      // Nothing new for someone working their notice, or for a course recorded by hand only.
      if (employee.status !== 'Active' || !course.assignAutomatically) continue

      const nextCycle = cycles.reduce((highest, assignment) => Math.max(highest, assignment.cycle), 0) + 1
      const latest = cycles.filter((assignment) => assignment.status !== 'cancelled').sort((a, b) => b.cycle - a.cycle)[0]

      let reason: TrainingAssignmentReason | null = null
      let dueOn: string | null = null
      if (!latest) {
        reason = firstCycleReason(employee, course, today)
        dueOn = computeInitialDueOn({
          reason,
          employmentStartDate: employee.employmentStartDate,
          today,
          newStarterDays: course.newStarterDueDays,
          existingStaffDays: course.existingStaffDueDays,
        })
      } else if (latest.status === 'completed') {
        const redo = course.latestRedoVersion
        const windowOpensOn = latest.windowOpensOn ?? latest.expiresOn
        if (redo && latest.versionNumber && isNewer(redo, latest.versionNumber)) {
          reason = 'redo'
          dueOn = addDays(today, REDO_DUE_DAYS)
        } else if (windowOpensOn && latest.expiresOn && today >= windowOpensOn) {
          reason = course.kind === 'external' ? 'renewal' : 'refresher'
          dueOn = refresherDueOn(latest.expiresOn, today)
        }
      }
      // A waived latest cycle stays waived: nothing new until a manager assigns it.
      if (reason === null) continue

      personActions.push({
        type: 'create',
        employeeId,
        courseId: course.id,
        cycle: nextCycle,
        reason,
        status: prerequisiteValid ? 'assigned' : 'waiting',
        assignedOn: today,
        dueOn: prerequisiteValid ? dueOn : null,
      })
    }

    // A pause that ended before today: clear it and give every open cycle its grace period.
    if (profile?.pausedUntil && profile.pausedUntil < today) {
      const resumedOn = addDays(profile.pausedUntil, 1)
      const dueChanges: Array<{ assignmentId: string; dueOn: string | null }> = []
      for (const assignment of [...openCycles].sort(byCourseThenCycle(courses))) {
        if (handled.has(assignment.id)) continue
        const dueOn = resumeDueOn(assignment.dueOn, resumedOn)
        if (dueOn !== assignment.dueOn) dueChanges.push({ assignmentId: assignment.id, dueOn })
      }
      actions.push({ type: 'end_pause', employeeId, resumedOn, dueChanges })
    }
    actions.push(...personActions)
  }

  return actions
}

/** Sorts cycles by the order courses were given, then cycle number, so output order is stable. */
function byCourseThenCycle(courses: readonly SyncCourse[]) {
  const position = new Map(courses.map((course, index) => [course.id, index]))
  return (a: SyncAssignment, b: SyncAssignment): number =>
    (position.get(a.courseId) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.courseId) ?? Number.MAX_SAFE_INTEGER) ||
    (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0) ||
    a.cycle - b.cycle
}

/** Counts for `SyncResult`: create to created, cancel to cancelled, release and end_pause to updated (flags count nothing). */
export function summariseSyncActions(actions: readonly SyncAction[]): SyncResult {
  const result: SyncResult = { created: 0, cancelled: 0, updated: 0 }
  for (const action of actions) {
    if (action.type === 'create') result.created += 1
    else if (action.type === 'cancel') result.cancelled += 1
    else if (action.type === 'release' || action.type === 'end_pause') result.updated += 1
  }
  return result
}
