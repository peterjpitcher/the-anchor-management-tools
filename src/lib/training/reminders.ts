import { shiftIsoDate } from '@/lib/dateUtils'
import { daysBetween, londonDateOf, mondayOf } from './dates'
import { DUE_SOON_DAYS, daysOverdue, isOpenStatus } from './states'
import {
  MANAGER_TRIGGERS,
  TRAINING_IN_SCOPE_STATUSES,
  TrainingError,
  type ManagerTrigger,
  type StaffReminderStep,
  type TrainingAssignmentStatus,
  type TrainingCourseKind,
  type TrainingEmployeeStatus,
  type TrainingReminderKind,
} from './types'

/**
 * The chasing planners (build contract section 3, "Reminders"; spec 8.1 to 8.4). Pure: they read
 * a snapshot, including the claim keys already in `training_reminders`, and say what to claim and
 * send. The daily job (src/lib/training/daily-job.ts) claims, sends through `sendEmail`, then keeps
 * or releases the claims: accepted or uncertain keeps every claim (uncertain is reported, never
 * resent); a definite refusal or a suspended send releases them for the next run.
 *
 * Claim keys (unique in `training_reminders.claim_key`):
 * - `step:<assignmentId>:<step>:<dueOn>` (kind staff_step; a moved due date makes new keys)
 * - `weekly:<assignmentId>:<monday>` (kind staff_step; the London Monday of the week)
 * - `cap:<employeeId>:<date>` (kind daily_cap; one staff email per person per London day)
 * - `manager:<date>` (kind manager_daily; one manager email per London day)
 * - `esc:<assignmentId>:<trigger>[:<instance>]` (kind escalation; each problem told once; the
 *   instance is the due date for an overdue trigger and the London date of the lock or decline,
 *   so an extended item that runs late again, or a second lock, is told again)
 * - `nologin:<employeeId>` (kind no_login) and `undeliverable:<employeeId>` (kind undeliverable)
 *
 * How the staff ladder reads (one step per item per run, the first that fits):
 * 1. After the due date: `overdue` once for that due date, then `weekly` once in each later
 *    London week (sent on the Monday, or later that week when Monday's did not go).
 * 2. Before or on the due date, when the item has never had its `assigned` email (under any due
 *    date): `assigned`. Sent late (the job missed days, or emails were switched on after the item
 *    was set), it also takes the claim of the window it fell in, so the person does not get a
 *    nudge or a due soon email the very next day.
 * 3. From DUE_SOON_DAYS before the due date until the due date: `due_soon`.
 * 4. From NUDGE_AFTER_DAYS after assignment until the due soon window: `nudge`.
 * The overdue email also takes the weekly claim of its own week, so the first weekly email comes
 * the Monday after it, never the next morning.
 */

/** The nudge window opens this many days after assignment. */
export const NUDGE_AFTER_DAYS = 3

/** A non-essentials item reaches the manager email at this many days overdue. */
export const MANAGER_OVERDUE_DAYS = 7

/** One cycle the staff ladder might chase. */
export interface StaffReminderItem {
  assignmentId: string
  courseId: string
  courseTitle: string
  courseKind: TrainingCourseKind
  status: TrainingAssignmentStatus
  assignedOn: string
  dueOn: string | null
  /**
   * The cycle's signing document is completed or superseded although the record has not caught up
   * yet (spec 8.2). Such an item is never chased.
   */
  confirmationSettled: boolean
  /** Where they stopped, for the nudge wording. */
  progress: { sectionsPassed: number; sectionsTotal: number; currentSectionTitle: string | null }
}

/** One person and everything of theirs the ladder might chase. */
export interface StaffReminderPerson {
  employeeId: string
  /** First or preferred name, for the greeting. */
  name: string
  email: string | null
  employeeStatus: TrainingEmployeeStatus
  hasLogin: boolean
  paused: boolean
  /** The address is on the suppression list or bouncing. */
  emailSuppressed: boolean
  items: StaffReminderItem[]
}

export interface StaffReminderInput {
  /** London date of the run. */
  today: string
  /** The `training_emails_enabled` setting (off by default). */
  emailsEnabled: boolean
  /** `SUSPEND_ALL_EMAIL` or `SUSPEND_ALL_COMMS` is on. */
  suspended: boolean
  people: StaffReminderPerson[]
  /** Claim keys already in `training_reminders`, whatever their status. */
  existingClaims: ReadonlySet<string>
}

/** One step to claim and list in a person's email. */
export interface PlannedReminderStep {
  assignmentId: string
  courseId: string
  courseTitle: string
  step: StaffReminderStep
  claimKey: string
  /**
   * Further claims taken with this step that list nothing in the email: the window an `assigned`
   * email sent late fell in, and the week of the `overdue` email (see the ladder above). Claimed,
   * kept and released together with `claimKey`. Use `staffEmailClaimKeys` to get every key.
   */
  alsoClaims: string[]
  dueOn: string
  /** Whole days overdue for the overdue and weekly steps, else null. */
  daysOverdue: number | null
  progress: StaffReminderItem['progress']
}

/** One email to send: every step due for one person today. */
export interface PlannedStaffEmail {
  employeeId: string
  name: string
  email: string
  /** `cap:<employeeId>:<today>`, claimed with the steps. */
  capClaimKey: string
  steps: PlannedReminderStep[]
}

type StaffReminderSkipReason =
  | 'emails_off'
  | 'suspended'
  | 'left'
  | 'paused'
  | 'no_login'
  | 'no_email'
  | 'suppressed'
  | 'already_emailed_today'
  | 'nothing_due'

export interface StaffReminderPlan {
  emails: PlannedStaffEmail[]
  /** People with chaseable items who get nothing today, and why. */
  skipped: Array<{ employeeId: string; reason: StaffReminderSkipReason }>
}

/** An open cycle as the manager email sees it. */
export interface ManagerDailyAssignment {
  assignmentId: string
  employeeId: string
  employeeName: string
  courseId: string
  courseTitle: string
  isEssentials: boolean
  status: TrainingAssignmentStatus
  dueOn: string | null
  lockedSection: string | null
  /**
   * When the section locked (`training_assignments.locked_at`). Optional; when given, a second
   * lock after an unlock is told again. Left out, each cycle's lock is told once.
   */
  lockedAt?: string | null
  /** When the confirmation was declined (`declined_at`); the same as `lockedAt` for a decline. */
  declinedAt?: string | null
  /** The person is paused today; nothing of theirs is escalated as overdue. */
  paused: boolean
}

/** A person as the manager email sees them. */
export interface ManagerDailyPerson {
  employeeId: string
  employeeName: string
  hasLogin: boolean
  /** Training email to them was refused, suppressed or bounced. */
  emailUndeliverable: boolean
  /** They have at least one open online cycle (no login only matters then). */
  hasOpenTraining: boolean
}

export interface ManagerDailyInput {
  today: string
  emailsEnabled: boolean
  suspended: boolean
  assignments: ManagerDailyAssignment[]
  people: ManagerDailyPerson[]
  /** Cycles whose certificate pack still could not be prepared after the daily retry. */
  certificateFailures: Array<{ assignmentId: string; employeeId: string; employeeName: string; courseTitle: string }>
  existingClaims: ReadonlySet<string>
}

/** One new problem for the manager email. */
export interface ManagerDailyItem {
  trigger: ManagerTrigger
  /** The claim that stops this problem being told twice. */
  claimKey: string
  kind: Extract<TrainingReminderKind, 'escalation' | 'no_login' | 'undeliverable'>
  employeeId: string
  employeeName: string
  assignmentId: string | null
  courseTitle: string | null
  dueOn: string | null
  daysOverdue: number | null
}

export interface ManagerDailyPlan {
  /** False on a quiet day (nothing new), when emails are off, suspended, or `manager:<today>` is held. */
  send: boolean
  /** `manager:<today>`. */
  dayClaimKey: string
  /** Only problems whose claim is not already held. Empty whenever `send` is false. */
  items: ManagerDailyItem[]
}

export function staffStepClaimKey(assignmentId: string, step: Exclude<StaffReminderStep, 'weekly'>, dueOn: string): string {
  return `step:${assignmentId}:${step}:${dueOn}`
}

export function weeklyClaimKey(assignmentId: string, monday: string): string {
  return `weekly:${assignmentId}:${monday}`
}

export function dailyCapClaimKey(employeeId: string, londonDate: string): string {
  return `cap:${employeeId}:${londonDate}`
}

export function managerDayClaimKey(londonDate: string): string {
  return `manager:${londonDate}`
}

/** `esc:<assignmentId>:<trigger>`, with `:<instance>` appended when one is given. */
export function escalationClaimKey(assignmentId: string, trigger: ManagerTrigger, instance?: string | null): string {
  return instance ? `esc:${assignmentId}:${trigger}:${instance}` : `esc:${assignmentId}:${trigger}`
}

export function noLoginClaimKey(employeeId: string): string {
  return `nologin:${employeeId}`
}

export function undeliverableClaimKey(employeeId: string): string {
  return `undeliverable:${employeeId}`
}

/** Every claim key one staff email takes: the daily cap, each step, and each step's `alsoClaims`. */
export function staffEmailClaimKeys(email: PlannedStaffEmail): string[] {
  return [email.capClaimKey, ...email.steps.flatMap((step) => [step.claimKey, ...step.alsoClaims])]
}

const CHASED_STATUSES: ReadonlySet<TrainingAssignmentStatus> = new Set(['assigned', 'in_progress', 'awaiting_confirmation'])
const IN_SCOPE: ReadonlySet<TrainingEmployeeStatus> = new Set(TRAINING_IN_SCOPE_STATUSES)

/** Whether the ladder chases this item at all (before anything about the person). */
function isChaseableItem(item: StaffReminderItem): item is StaffReminderItem & { dueOn: string } {
  return item.courseKind === 'online' && CHASED_STATUSES.has(item.status) && item.dueOn !== null && !item.confirmationSettled
}

/** Why this person gets no staff email, or null when they can be emailed. */
function personSkipReason(
  person: Pick<StaffReminderPerson, 'email' | 'employeeStatus' | 'hasLogin' | 'paused' | 'emailSuppressed'>
): StaffReminderSkipReason | null {
  if (!IN_SCOPE.has(person.employeeStatus)) return 'left'
  if (person.paused) return 'paused'
  if (!person.hasLogin) return 'no_login'
  if (!person.email || !person.email.trim()) return 'no_email'
  if (person.emailSuppressed) return 'suppressed'
  return null
}

/** Assignment ids that have had an `assigned` claim under any due date. */
function assignmentsWithAssignedClaim(claims: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>()
  for (const key of claims) {
    const match = /^step:([^:]+):assigned:/.exec(key)
    if (match) ids.add(match[1])
  }
  return ids
}

function addDays(isoDate: string, days: number): string {
  const moved = shiftIsoDate(isoDate, days)
  if (moved === null) throw new TrainingError('invalid', `Cannot move ${isoDate} by ${days} days`)
  return moved
}

interface DueStep {
  step: StaffReminderStep
  claimKey: string
  alsoClaims: string[]
  daysOverdue: number | null
}

/** The one step due for a chaseable item on `today`, or null (see the ladder at the top). */
function dueStepFor(
  item: StaffReminderItem & { dueOn: string },
  today: string,
  held: (key: string) => boolean,
  assignedEverSent: boolean
): DueStep | null {
  const { assignmentId, assignedOn, dueOn } = item
  if (today < assignedOn) return null

  if (today > dueOn) {
    const days = daysBetween(dueOn, today)
    const overdueKey = staffStepClaimKey(assignmentId, 'overdue', dueOn)
    const weeklyKey = weeklyClaimKey(assignmentId, mondayOf(today))
    if (!held(overdueKey)) {
      return { step: 'overdue', claimKey: overdueKey, alsoClaims: held(weeklyKey) ? [] : [weeklyKey], daysOverdue: days }
    }
    if (!held(weeklyKey)) return { step: 'weekly', claimKey: weeklyKey, alsoClaims: [], daysOverdue: days }
    return null
  }

  const inDueSoon = today >= addDays(dueOn, -DUE_SOON_DAYS)
  const inNudge = !inDueSoon && today >= addDays(assignedOn, NUDGE_AFTER_DAYS)
  const windowKey = inDueSoon
    ? staffStepClaimKey(assignmentId, 'due_soon', dueOn)
    : inNudge
      ? staffStepClaimKey(assignmentId, 'nudge', dueOn)
      : null

  if (!assignedEverSent) {
    return {
      step: 'assigned',
      claimKey: staffStepClaimKey(assignmentId, 'assigned', dueOn),
      alsoClaims: windowKey && !held(windowKey) ? [windowKey] : [],
      daysOverdue: null,
    }
  }
  if (windowKey && !held(windowKey)) {
    return { step: inDueSoon ? 'due_soon' : 'nudge', claimKey: windowKey, alsoClaims: [], daysOverdue: null }
  }
  return null
}

/**
 * The staff emails for one run (spec 8.1, 8.2, 8.4). Steps: `assigned` (from assignment),
 * `nudge` (from NUDGE_AFTER_DAYS after assignment until DUE_SOON_DAYS before due), `due_soon`
 * (DUE_SOON_DAYS before due until due), `overdue` (from the day after due), `weekly` (each London
 * Monday after the overdue email, made up later that week if Monday's did not go). Each window
 * catches up a missed day. Only `online` items in `assigned`, `in_progress` or
 * `awaiting_confirmation` with a due date are chased; never practical or external, waiting,
 * locked, declined, `confirmationSettled`, paused, left (not Active or Started Separation), no
 * login, no or suppressed address, emails off, or suspended. At most one email per person per
 * London day (`cap:` claim), listing every step due.
 */
export function planStaffReminders(input: StaffReminderInput): StaffReminderPlan {
  const { today, existingClaims } = input
  const held = (key: string) => existingClaims.has(key)
  const assignedSent = assignmentsWithAssignedClaim(existingClaims)
  const plan: StaffReminderPlan = { emails: [], skipped: [] }

  for (const person of input.people) {
    const items = person.items.filter(isChaseableItem)
    if (items.length === 0) continue
    const employeeId = person.employeeId

    const reason: StaffReminderSkipReason | null = !input.emailsEnabled
      ? 'emails_off'
      : input.suspended
        ? 'suspended'
        : personSkipReason(person)
    if (reason) {
      plan.skipped.push({ employeeId, reason })
      continue
    }

    const capClaimKey = dailyCapClaimKey(employeeId, today)
    if (held(capClaimKey)) {
      plan.skipped.push({ employeeId, reason: 'already_emailed_today' })
      continue
    }

    const steps: PlannedReminderStep[] = []
    for (const item of items) {
      const due = dueStepFor(item, today, held, assignedSent.has(item.assignmentId))
      if (!due) continue
      steps.push({
        assignmentId: item.assignmentId,
        courseId: item.courseId,
        courseTitle: item.courseTitle,
        step: due.step,
        claimKey: due.claimKey,
        alsoClaims: due.alsoClaims,
        dueOn: item.dueOn,
        daysOverdue: due.daysOverdue,
        progress: item.progress,
      })
    }

    if (steps.length === 0) {
      plan.skipped.push({ employeeId, reason: 'nothing_due' })
      continue
    }
    plan.emails.push({ employeeId, name: person.name, email: (person.email as string).trim(), capClaimKey, steps })
  }

  return plan
}

/** London date of an instant for a claim instance, or null when it is missing or not a time. */
function instanceDate(instant: string | null | undefined): string | null {
  if (!instant) return null
  try {
    return londonDateOf(instant)
  } catch {
    return null
  }
}

/**
 * The manager email for one run (spec 8.3): an essentials item overdue from the morning after it
 * was due; any other item MANAGER_OVERDUE_DAYS overdue; a locked section; a declined
 * confirmation; someone with open training and no portal login; training emails that cannot be
 * delivered; a certificate pack that could not be prepared after retrying. Only problems not
 * already claimed; nothing at all on a quiet day. Items come grouped in MANAGER_TRIGGERS order,
 * keeping the input order within each group.
 *
 * Spec 8.3 also names "the alcohol course for anyone in Bar"; in this build the age check policy
 * is part of Essentials, so the essentials trigger covers it.
 */
export function planManagerDaily(input: ManagerDailyInput): ManagerDailyPlan {
  const { today, existingClaims } = input
  const dayClaimKey = managerDayClaimKey(today)
  if (!input.emailsEnabled || input.suspended || existingClaims.has(dayClaimKey)) {
    return { send: false, dayClaimKey, items: [] }
  }

  const found: ManagerDailyItem[] = []
  for (const assignment of input.assignments) {
    if (!isOpenStatus(assignment.status)) continue
    const overdueBy = daysOverdue(assignment.dueOn, today)
    const base = {
      kind: 'escalation' as const,
      employeeId: assignment.employeeId,
      employeeName: assignment.employeeName,
      assignmentId: assignment.assignmentId,
      courseTitle: assignment.courseTitle,
      dueOn: assignment.dueOn,
      daysOverdue: overdueBy,
    }
    const add = (trigger: ManagerTrigger, instance: string | null) =>
      found.push({ ...base, trigger, claimKey: escalationClaimKey(assignment.assignmentId, trigger, instance) })

    if (overdueBy !== null && !assignment.paused) {
      if (assignment.isEssentials) add('essentials_overdue', assignment.dueOn)
      else if (overdueBy >= MANAGER_OVERDUE_DAYS) add('overdue_7_days', assignment.dueOn)
    }
    if (assignment.status === 'locked') add('locked', instanceDate(assignment.lockedAt))
    if (assignment.status === 'declined') add('declined', instanceDate(assignment.declinedAt))
  }

  for (const person of input.people) {
    const base = {
      employeeId: person.employeeId,
      employeeName: person.employeeName,
      assignmentId: null,
      courseTitle: null,
      dueOn: null,
      daysOverdue: null,
    }
    if (person.hasOpenTraining && !person.hasLogin) {
      found.push({ ...base, trigger: 'no_login', kind: 'no_login', claimKey: noLoginClaimKey(person.employeeId) })
    }
    if (person.emailUndeliverable) {
      found.push({ ...base, trigger: 'undeliverable', kind: 'undeliverable', claimKey: undeliverableClaimKey(person.employeeId) })
    }
  }

  for (const failure of input.certificateFailures) {
    found.push({
      trigger: 'certificate_failed',
      kind: 'escalation',
      claimKey: escalationClaimKey(failure.assignmentId, 'certificate_failed'),
      employeeId: failure.employeeId,
      employeeName: failure.employeeName,
      assignmentId: failure.assignmentId,
      courseTitle: failure.courseTitle,
      dueOn: null,
      daysOverdue: null,
    })
  }

  const seen = new Set<string>()
  const fresh = found.filter((item) => {
    if (existingClaims.has(item.claimKey) || seen.has(item.claimKey)) return false
    seen.add(item.claimKey)
    return true
  })
  const order = new Map(MANAGER_TRIGGERS.map((trigger, index) => [trigger, index]))
  const items = fresh
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (order.get(a.item.trigger) ?? 0) - (order.get(b.item.trigger) ?? 0) || a.index - b.index)
    .map(({ item }) => item)

  return { send: items.length > 0, dayClaimKey, items }
}

/**
 * The next staff reminder the ladder would send for one item, for "next reminder" on the
 * employee record, or null when the item would not be chased. Today counts when the step is not
 * yet claimed (the morning job may not have run). It does not know whether the person already had
 * today's email for another item; in that rare case the real send is the next day.
 */
export function forecastNextReminder(input: {
  item: StaffReminderItem
  person: Pick<StaffReminderPerson, 'email' | 'employeeStatus' | 'hasLogin' | 'paused' | 'emailSuppressed'>
  today: string
  emailsEnabled: boolean
  existingClaims: ReadonlySet<string>
}): { step: StaffReminderStep; onDate: string } | null {
  const { item, person, today, existingClaims } = input
  if (!input.emailsEnabled || !isChaseableItem(item) || personSkipReason(person)) return null

  const held = (key: string) => existingClaims.has(key)
  const assignedEverSent = assignmentsWithAssignedClaim(existingClaims).has(item.assignmentId)
  // Every pre-due day sits in a window and overdue items have a weekly step each week, so a step
  // always turns up within the due date (or assignment date) plus one week.
  const horizon = Math.max(daysBetween(today, item.dueOn), daysBetween(today, item.assignedOn), 0) + 8
  for (let offset = 0; offset <= horizon; offset += 1) {
    const day = addDays(today, offset)
    const due = dueStepFor(item, day, held, assignedEverSent)
    if (due) return { step: due.step, onDate: day }
  }
  return null
}
