'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { isValidIsoDate } from '@/lib/dateUtils'
import { getSigningStaffUser, type SigningStaffUser } from '@/lib/signing/staff'
import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'
import {
  computeExpiresOn,
  computeInitialDueOn,
  computeWindowOpensOn,
  daysBetween,
  isAllowedExtension,
  resumeDueOn,
  trainingToday,
  unlockDueOn,
} from '@/lib/training/dates'
import { createPracticalSignoff, prepareTrainingCertificate } from '@/lib/training/signing'
import { isOpenStatus, prerequisiteMet, withSectionUnlocked } from '@/lib/training/states'
import { EXTERNAL_CERTIFICATE_MAX_BYTES, formatMegabytes, uploadExternalCertificate } from '@/lib/training/storage'
import { courseAppliesTo } from '@/lib/training/sync'
import { PAY_REPORT_MAX_DAYS, TrainingService, type TrainingPerson } from '@/services/training'
import {
  TRAINING_GROUPS,
  TRAINING_IN_SCOPE_STATUSES,
  TRAINING_PAUSE_REASONS,
  TrainingError,
  type ActivityPage,
  type EmployeeTrainingView,
  type NewTrainingEvent,
  type PauseReason,
  type PayReport,
  type StaffActor,
  type SyncResult,
  type TrainingActionResult,
  type TrainingAssignment,
  type TrainingCourse,
  type TrainingGroup,
  type TrainingMatrix,
} from '@/lib/training/types'

/**
 * Manager training actions (build contract section 5.2). Each one checks
 * `checkUserPermission('training', <action>)` first (permission failures throw, as elsewhere in
 * the app), validates with Zod, does its work through TrainingService, writes a `training_events`
 * row and `logAuditEvent` for every change, and revalidates `/employees/training` and the
 * employee's record. Dates are London `YYYY-MM-DD`.
 *
 * Refusals the manager should read come back as `{ error }` in plain words. Anything unexpected is
 * logged and comes back as a general "please try again", never as a raw database message. A change
 * that only partly landed says so, so nothing is silently half done.
 */

export interface AssignCourseInput {
  employeeIds: string[]
  courseId: string
  /** Null or left out: the course's own rule (or no due date). */
  dueOn?: string | null
  note?: string
}

export interface AssignCourseResult {
  created: number
  /** People who already had an open cycle or are out of scope, with why. */
  skipped: Array<{ employeeId: string; reason: 'already_open' | 'not_in_scope' | 'not_applicable' }>
}

export interface PracticalSignoffInput {
  employeeId: string
  courseId: string
  /** Task keys from the course, the ones the manager watched. */
  tasks: string[]
  /** London date the tasks were watched; today or earlier. */
  observedOn: string
  note?: string
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const UuidSchema = z.string().uuid()
const IsoDateSchema = z.string().refine((value) => isValidIsoDate(value), 'Choose a real date.')
const ReasonSchema = z
  .string()
  .trim()
  .min(3, 'Say briefly why.')
  .max(300, 'Keep the reason under 300 characters.')
const OptionalNoteSchema = z.string().trim().max(500, 'Keep the note under 500 characters.').optional()

const AssignSchema = z.object({
  employeeIds: z.array(UuidSchema).min(1, 'Choose at least one person.').max(200, 'Choose at most 200 people at a time.'),
  courseId: UuidSchema,
  dueOn: IsoDateSchema.nullable().optional(),
  note: OptionalNoteSchema,
})

const ExtendSchema = z.object({ assignmentId: UuidSchema, dueOn: IsoDateSchema, reason: ReasonSchema })
const WaiveSchema = z.object({ assignmentId: UuidSchema, reason: ReasonSchema })
const UnlockSchema = z.object({ assignmentId: UuidSchema, note: ReasonSchema })

const GroupsSchema = z.object({
  employeeId: UuidSchema,
  groups: z.array(z.enum(TRAINING_GROUPS)).max(TRAINING_GROUPS.length),
  confirm: z.boolean(),
})

const AdjustmentSchema = z.object({
  employeeId: UuidSchema,
  note: z.string().trim().max(300, 'Keep the adjustment under 300 characters.').nullable(),
})

const PauseSchema = z.object({
  employeeId: UuidSchema,
  from: IsoDateSchema,
  until: IsoDateSchema.nullable(),
  reason: z.enum(TRAINING_PAUSE_REASONS),
})

const SignoffSchema = z.object({
  employeeId: UuidSchema,
  courseId: UuidSchema,
  tasks: z.array(z.string().trim().min(1).max(60)).min(1, 'Tick the tasks you watched.').max(20),
  observedOn: IsoDateSchema,
  note: OptionalNoteSchema,
})

const ExternalSchema = z.object({
  employeeId: UuidSchema,
  courseId: UuidSchema,
  issuer: z.string().trim().min(2, 'Say who issued the certificate.').max(120, 'Keep the issuer under 120 characters.'),
  reference: z.string().trim().max(120, 'Keep the reference under 120 characters.'),
  issuedOn: IsoDateSchema,
  expiresOn: IsoDateSchema.nullable(),
})

const PayReportSchema = z.object({ from: IsoDateSchema, to: IsoDateSchema })

const ActivitySchema = z.object({
  page: z.number().int().min(1).max(100_000).optional(),
  employeeId: UuidSchema.optional(),
})

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** The signed-in member of staff, after the permission check. Throws as the rest of the app does. */
async function requireTrainingUser(action: 'view' | 'manage'): Promise<SigningStaffUser> {
  const user = await getSigningStaffUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', action, user.id))) throw new Error('Insufficient permissions')
  return user
}

function actorOf(user: SigningStaffUser): StaffActor {
  return { id: user.id, name: user.name }
}

function failure(error: unknown, what: string): { error: string } {
  // A TrainingError carries words written for the manager. Anything else is ours and is not shown raw.
  if (error instanceof TrainingError) return { error: error.message }
  console.error(`Training action failed (${what}):`, error)
  return { error: 'Something went wrong. Please try again.' }
}

function firstIssue(error: z.ZodError, fallback: string): string {
  const message = error.issues[0]?.message
  return message && message !== 'Required' && !message.startsWith('Invalid') && !message.startsWith('Expected') ? message : fallback
}

async function audit(
  user: SigningStaffUser,
  operationType: string,
  resourceType: string,
  resourceId: string,
  info: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    user_id: user.id,
    ...(user.email ? { user_email: user.email } : {}),
    operation_type: operationType,
    resource_type: resourceType,
    resource_id: resourceId,
    operation_status: 'success',
    additional_info: info,
  })
}

/**
 * Writes the training log line for a change that has already been saved. A failed write is
 * logged, never thrown: the change stands, so the manager must be told it worked. Reporting a
 * failure here would invite a second try that either fails ("already closed") or, for an external
 * qualification, records the certificate twice.
 */
async function recordEventAfterChange(event: NewTrainingEvent): Promise<void> {
  try {
    await TrainingService.writeEvent(event)
  } catch (error) {
    console.error('Training change saved, but its training log line could not be written:', {
      eventType: event.eventType,
      employeeId: event.employeeId ?? null,
      assignmentId: event.assignmentId ?? null,
      error,
    })
  }
}

function revalidateTraining(employeeIds: readonly string[] = []): void {
  revalidatePath('/employees/training')
  revalidatePath('/portal/training')
  for (const employeeId of new Set(employeeIds)) revalidatePath(`/employees/${employeeId}`)
}

async function loadOpenAssignment(assignmentId: string): Promise<TrainingAssignment> {
  const assignment = await TrainingService.getAssignment(assignmentId)
  if (!assignment) throw new TrainingError('not_found', 'That training item could not be found.')
  if (!isOpenStatus(assignment.status)) {
    throw new TrainingError('not_allowed', 'This training item is closed, so it cannot be changed.')
  }
  return assignment
}

async function loadPerson(employeeId: string): Promise<TrainingPerson> {
  const [person] = await TrainingService.getTrainingPeople([employeeId])
  if (!person) throw new TrainingError('not_found', 'That employee could not be found.')
  return person
}

/**
 * The person, refused unless they are current staff (Active or Started Separation). Training is
 * only set up once someone is Active: a starter still onboarding must have no training rows, or
 * deleteEmployee (Onboarding only) can never remove a starter who did not take up the job.
 */
async function loadCurrentStaff(employeeId: string): Promise<TrainingPerson> {
  const person = await loadPerson(employeeId)
  if (!(TRAINING_IN_SCOPE_STATUSES as readonly string[]).includes(person.status)) {
    throw new TrainingError(
      'not_allowed',
      person.status === 'Onboarding'
        ? 'Training is set up once they are Active, so nothing was changed.'
        : 'Training can only be changed for current staff, so nothing was changed.'
    )
  }
  return person
}

async function loadLiveCourse(courseId: string): Promise<TrainingCourse> {
  const course = await TrainingService.getCourseById(courseId)
  if (!course) throw new TrainingError('not_found', 'That course could not be found.')
  if (course.status !== 'live') throw new TrainingError('not_allowed', `${course.title} is not live, so it cannot be used yet.`)
  return course
}

function nextCycle(assignments: readonly TrainingAssignment[], courseId: string): number {
  return assignments.filter((assignment) => assignment.courseId === courseId).reduce((max, a) => Math.max(max, a.cycle), 0) + 1
}

/** A course's age rule, ignoring its groups (a manager may assign outside them on purpose). */
function ageRuleAllows(course: TrainingCourse, person: TrainingPerson, today: string): boolean {
  return courseAppliesTo(course, { groups: course.audienceGroups, dateOfBirth: person.dateOfBirth }, today).applies
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** training:view. The matrix: Active and Started Separation staff against live courses. */
export async function getTrainingMatrix(): Promise<TrainingActionResult<TrainingMatrix>> {
  await requireTrainingUser('view')
  try {
    return { success: true, data: await TrainingService.getMatrix() }
  } catch (error) {
    return failure(error, 'matrix')
  }
}

/** training:view. One person's Training tab; runs `syncAssignments({ employeeId })` first. */
export async function getEmployeeTraining(employeeId: string): Promise<TrainingActionResult<EmployeeTrainingView>> {
  await requireTrainingUser('view')
  const parsed = UuidSchema.safeParse(employeeId)
  if (!parsed.success) return { error: 'That employee could not be found.' }
  try {
    try {
      // Brings the record up to date before it is shown. A failed sync still shows what is stored.
      await TrainingService.syncAssignments({ employeeId: parsed.data })
    } catch (error) {
      console.error('Training sync before the employee record failed:', error)
    }
    const view = await TrainingService.getEmployeeTraining(parsed.data)
    if (!view) return { error: 'That employee could not be found.' }
    return { success: true, data: view }
  } catch (error) {
    return failure(error, 'employee record')
  }
}

/** training:view. The training log, newest first, 1-based pages. */
export async function getTrainingActivity(input: { page?: number; employeeId?: string }): Promise<TrainingActionResult<ActivityPage>> {
  await requireTrainingUser('view')
  const parsed = ActivitySchema.safeParse(input ?? {})
  if (!parsed.success) return { error: 'That page of the training log could not be shown.' }
  try {
    return { success: true, data: await TrainingService.getActivity({ page: parsed.data.page, employeeId: parsed.data.employeeId }) }
  } catch (error) {
    return failure(error, 'activity')
  }
}

/** training:view. Check time per person between two London dates, with the minutes outside shifts. */
export async function getTrainingPayReport(input: { from: string; to: string }): Promise<TrainingActionResult<PayReport>> {
  await requireTrainingUser('view')
  const parsed = PayReportSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Choose a start and an end date.') }
  const { from, to } = parsed.data
  if (from > to) return { error: 'The start date must be on or before the end date.' }
  if (daysBetween(from, to) + 1 > PAY_REPORT_MAX_DAYS) {
    return { error: `Choose at most ${PAY_REPORT_MAX_DAYS} days at a time.` }
  }
  try {
    return { success: true, data: await TrainingService.getPayReport({ from, to }) }
  } catch (error) {
    return failure(error, 'pay report')
  }
}

// ---------------------------------------------------------------------------------------------
// Assignment changes
// ---------------------------------------------------------------------------------------------

/** training:manage. Runs the assignment sweep for everyone now. */
export async function syncTrainingNow(): Promise<TrainingActionResult<SyncResult>> {
  const user = await requireTrainingUser('manage')
  try {
    const result = await TrainingService.syncAssignments({ actor: actorOf(user) })
    await audit(user, 'sync', 'training', 'all', { ...result })
    revalidateTraining()
    return { success: true, data: result }
  } catch (error) {
    console.error('Training sync now failed:', error)
    revalidateTraining()
    return { error: 'Some training could not be brought up to date. Anything that worked has been saved; please try again.' }
  }
}

/** training:manage. Creates a `manual` cycle for each person who has no open cycle on the course. */
export async function assignCourse(input: AssignCourseInput): Promise<TrainingActionResult<AssignCourseResult>> {
  const user = await requireTrainingUser('manage')
  const parsed = AssignSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Choose a course and at least one person.') }
  const today = trainingToday()
  const { courseId, note } = parsed.data
  const dueOn = parsed.data.dueOn ?? null
  if (dueOn !== null && dueOn < today) return { error: 'The due date cannot be before today.' }
  const actor = actorOf(user)

  let course: TrainingCourse
  try {
    course = await loadLiveCourse(courseId)
  } catch (error) {
    return failure(error, 'assign: course')
  }

  const employeeIds = [...new Set(parsed.data.employeeIds)]
  const result: AssignCourseResult = { created: 0, skipped: [] }
  const createdIds: string[] = []
  let failed = 0

  try {
    const people = new Map((await TrainingService.getTrainingPeople(employeeIds)).map((person) => [person.employeeId, person]))
    for (const employeeId of employeeIds) {
      const person = people.get(employeeId)
      // New cycles are only for current staff; someone working their notice keeps what is open.
      if (!person || person.status !== 'Active') {
        result.skipped.push({ employeeId, reason: 'not_in_scope' })
        continue
      }
      if (!ageRuleAllows(course, person, today)) {
        result.skipped.push({ employeeId, reason: 'not_applicable' })
        continue
      }
      try {
        const assignments = await TrainingService.listAssignmentsForEmployee(employeeId)
        if (assignments.some((assignment) => assignment.courseId === course.id && isOpenStatus(assignment.status))) {
          result.skipped.push({ employeeId, reason: 'already_open' })
          continue
        }
        // Waiting on a prerequisite means no due date yet; sync sets one when it is released.
        const waiting = !prerequisiteMet(course.prerequisiteCourseId, assignments, today)
        const cycleDue = waiting
          ? null
          : dueOn ??
            computeInitialDueOn({
              reason: 'manual',
              employmentStartDate: person.employmentStartDate,
              today,
              newStarterDays: course.newStarterDueDays,
              existingStaffDays: course.existingStaffDueDays,
            })
        const cycle = nextCycle(assignments, course.id)
        const created = await TrainingService.createAssignment({
          employeeId,
          courseId: course.id,
          cycle,
          reason: 'manual',
          status: waiting ? 'waiting' : 'assigned',
          assignedOn: today,
          dueOn: cycleDue,
        })
        await recordEventAfterChange({
          eventType: 'assigned',
          employeeId,
          courseId: course.id,
          assignmentId: created.id,
          actor,
          noteCode: 'manual',
          note: note ?? null,
          meta: { cycle, reason: 'manual', status: created.status, dueOn: created.dueOn },
        })
        result.created += 1
        createdIds.push(employeeId)
      } catch (error) {
        if (error instanceof TrainingError && error.code === 'conflict') {
          result.skipped.push({ employeeId, reason: 'already_open' })
          continue
        }
        failed += 1
        console.error('Assigning training failed for one person:', { employeeId, courseId: course.id, error })
      }
    }
  } catch (error) {
    return failure(error, 'assign')
  }

  if (result.created > 0) {
    await audit(user, 'assign', 'training_course', course.id, {
      created: result.created,
      skipped: result.skipped.length,
      failed,
      due_on: dueOn,
      employee_ids: createdIds,
    })
  }
  revalidateTraining(createdIds)

  if (failed > 0) {
    return {
      error: `${course.title} was assigned to ${result.created} ${result.created === 1 ? 'person' : 'people'}, but ${failed} could not be assigned. Please try again for them.`,
      data: result,
    }
  }
  return { success: true, data: result }
}

/** training:manage. Moves an open cycle's due date later (never earlier), with a reason. */
export async function extendDueDate(input: {
  assignmentId: string
  dueOn: string
  reason: string
}): Promise<TrainingActionResult<{ dueOn: string }>> {
  const user = await requireTrainingUser('manage')
  const parsed = ExtendSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Choose a new due date and say why.') }
  const { assignmentId, dueOn, reason } = parsed.data
  const today = trainingToday()
  try {
    const assignment = await loadOpenAssignment(assignmentId)
    if (assignment.status === 'waiting') {
      return { error: 'This training is waiting for another course to be finished first, so it has no due date to move yet.' }
    }
    if (!isAllowedExtension(assignment.dueOn, dueOn, today)) {
      return {
        error: assignment.dueOn
          ? `The new due date must be after ${assignment.dueOn} and not before today.`
          : 'The new due date cannot be before today.',
      }
    }
    const updated = await TrainingService.updateAssignment(
      assignmentId,
      { dueOn, dueChangeReason: reason },
      { expectedStatuses: [assignment.status], expectedUpdatedAt: assignment.updatedAt }
    )
    await recordEventAfterChange({
      eventType: 'extended',
      employeeId: assignment.employeeId,
      courseId: assignment.courseId,
      assignmentId,
      actor: actorOf(user),
      note: reason,
      meta: { from: assignment.dueOn, to: dueOn },
    })
    await audit(user, 'extend', 'training_assignment', assignmentId, { from: assignment.dueOn, to: dueOn })
    revalidateTraining([assignment.employeeId])
    return { success: true, data: { dueOn: updated.dueOn ?? dueOn } }
  } catch (error) {
    return failure(error, 'extend')
  }
}

/** training:manage. Waives an open cycle, recording who and why. */
export async function waiveAssignment(input: { assignmentId: string; reason: string }): Promise<TrainingActionResult> {
  const user = await requireTrainingUser('manage')
  const parsed = WaiveSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Say why this training is being waived.') }
  const { assignmentId, reason } = parsed.data
  try {
    const assignment = await loadOpenAssignment(assignmentId)
    await TrainingService.updateAssignment(
      assignmentId,
      { status: 'waived', waivedAt: new Date().toISOString(), waivedBy: user.id, waivedByName: user.name, waiveReason: reason },
      { expectedStatuses: [assignment.status], expectedUpdatedAt: assignment.updatedAt }
    )
    await recordEventAfterChange({
      eventType: 'waived',
      employeeId: assignment.employeeId,
      courseId: assignment.courseId,
      assignmentId,
      actor: actorOf(user),
      note: reason,
      meta: { previousStatus: assignment.status },
    })
    await audit(user, 'waive', 'training_assignment', assignmentId, { previous_status: assignment.status })
    revalidateTraining([assignment.employeeId])
    return { success: true }
  } catch (error) {
    return failure(error, 'waive')
  }
}

/** training:manage. Unlocks the locked section: its fail count back to 0, the due date moved on by the days locked. */
export async function unlockSection(input: { assignmentId: string; note: string }): Promise<TrainingActionResult<{ dueOn: string | null }>> {
  const user = await requireTrainingUser('manage')
  const parsed = UnlockSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Add a short note about the unlock.') }
  const { assignmentId, note } = parsed.data
  const today = trainingToday()
  try {
    const assignment = await loadOpenAssignment(assignmentId)
    if (assignment.status !== 'locked' || !assignment.lockedSection) {
      return { error: 'This training is not locked.' }
    }
    const section = assignment.lockedSection
    const dueOn = assignment.lockedAt ? unlockDueOn(assignment.dueOn, assignment.lockedAt, today) : assignment.dueOn
    const moved = dueOn !== assignment.dueOn
    await TrainingService.updateAssignment(
      assignmentId,
      {
        status: 'in_progress',
        progress: withSectionUnlocked(assignment.progress, section),
        lockedAt: null,
        lockedSection: null,
        dueOn,
        ...(moved ? { dueChangeReason: 'Moved on by the days the section was locked' } : {}),
      },
      { expectedStatuses: ['locked'], expectedUpdatedAt: assignment.updatedAt }
    )
    await recordEventAfterChange({
      eventType: 'unlocked',
      employeeId: assignment.employeeId,
      courseId: assignment.courseId,
      assignmentId,
      actor: actorOf(user),
      note,
      meta: { section, dueFrom: assignment.dueOn, dueTo: dueOn },
    })
    await audit(user, 'unlock', 'training_assignment', assignmentId, { section, due_from: assignment.dueOn, due_to: dueOn })
    revalidateTraining([assignment.employeeId])
    return { success: true, data: { dueOn } }
  } catch (error) {
    return failure(error, 'unlock')
  }
}

// ---------------------------------------------------------------------------------------------
// Profile changes
// ---------------------------------------------------------------------------------------------

/**
 * training:manage. Sets a person's training groups. `confirm: true` records them as confirmed by
 * this manager (an empty list confirmed means "no groups"); then syncs that person.
 */
export async function setTrainingGroups(input: {
  employeeId: string
  groups: TrainingGroup[]
  confirm: boolean
}): Promise<TrainingActionResult<{ groups: TrainingGroup[]; sync: SyncResult }>> {
  const user = await requireTrainingUser('manage')
  const parsed = GroupsSchema.safeParse(input)
  if (!parsed.success) return { error: 'Choose the training groups from the list.' }
  const { employeeId, confirm } = parsed.data
  const groups = TRAINING_GROUPS.filter((group) => parsed.data.groups.includes(group))
  const actor = actorOf(user)
  try {
    await loadCurrentStaff(employeeId)
    const before = await TrainingService.getProfile(employeeId)
    await TrainingService.upsertProfile(employeeId, {
      groups,
      groupsConfirmedAt: confirm ? new Date().toISOString() : null,
      groupsConfirmedBy: confirm ? user.id : null,
      groupsConfirmedByName: confirm ? user.name : null,
    })
    await recordEventAfterChange({
      eventType: 'groups_changed',
      employeeId,
      actor,
      meta: { groups: [...groups], confirmed: confirm, previousGroups: [...(before?.groups ?? [])] },
    })
    await audit(user, 'update', 'training_profile', employeeId, { groups, confirmed: confirm, previous_groups: before?.groups ?? [] })
  } catch (error) {
    return failure(error, 'groups')
  }

  revalidateTraining([employeeId])
  try {
    const sync = await TrainingService.syncAssignments({ employeeId, actor })
    return { success: true, data: { groups, sync } }
  } catch (error) {
    console.error('Training sync after a groups change failed:', error)
    return { error: 'The groups were saved, but their training list could not be brought up to date. Use Sync now to try again.' }
  }
}

/**
 * training:manage. Records the adjustment a person's training uses (for example "read aloud
 * offered"), at most 300 characters and never a health detail; null clears it.
 *
 * There is no training event type for this note, so the change is recorded in the audit log only
 * (without the wording, which stays on the profile).
 */
export async function setTrainingAdjustmentNote(input: { employeeId: string; note: string | null }): Promise<TrainingActionResult> {
  const user = await requireTrainingUser('manage')
  const parsed = AdjustmentSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Check the adjustment note.') }
  const { employeeId } = parsed.data
  const note = parsed.data.note ? parsed.data.note : null
  try {
    await loadCurrentStaff(employeeId)
    await TrainingService.upsertProfile(employeeId, { adjustmentNote: note })
    await audit(user, 'update', 'training_profile', employeeId, { adjustment_note_set: note !== null })
    revalidateTraining([employeeId])
    return { success: true }
  } catch (error) {
    return failure(error, 'adjustment note')
  }
}

/** training:manage. Pauses a person's training from a date, until a date or until resumed. Chasing stops. */
export async function pauseTraining(input: {
  employeeId: string
  from: string
  until: string | null
  reason: PauseReason
}): Promise<TrainingActionResult> {
  const user = await requireTrainingUser('manage')
  const parsed = PauseSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Choose when the pause starts and why.') }
  const { employeeId, from, until, reason } = parsed.data
  const today = trainingToday()
  if (until !== null && until < from) return { error: 'The pause must end on or after the day it starts.' }
  if (until !== null && until < today) return { error: 'The pause must end today or later.' }
  try {
    await loadCurrentStaff(employeeId)
    await TrainingService.upsertProfile(employeeId, { pausedFrom: from, pausedUntil: until, pauseReason: reason })
    await recordEventAfterChange({
      eventType: 'paused',
      employeeId,
      actor: actorOf(user),
      noteCode: reason,
      meta: { from, until },
    })
    await audit(user, 'pause', 'training_profile', employeeId, { from, until, reason })
    revalidateTraining([employeeId])
    return { success: true }
  } catch (error) {
    return failure(error, 'pause')
  }
}

/** training:manage. Ends a pause now; each open due date becomes the later of itself and today + 14. */
export async function resumeTraining(input: { employeeId: string }): Promise<TrainingActionResult> {
  const user = await requireTrainingUser('manage')
  const parsed = z.object({ employeeId: UuidSchema }).safeParse(input)
  if (!parsed.success) return { error: 'That employee could not be found.' }
  const { employeeId } = parsed.data
  const today = trainingToday()
  try {
    const profile = await TrainingService.getProfile(employeeId)
    if (!profile?.pausedFrom) return { error: 'Their training is not paused.' }
    const started = profile.pausedFrom <= today

    // Due dates first, so a failure part way leaves the pause in place to be ended again. Each
    // move is the later of the date and today + 14, so doing it twice gives the same answer.
    let moved = 0
    if (started) {
      const open = (await TrainingService.listAssignmentsForEmployee(employeeId)).filter(
        (assignment) => isOpenStatus(assignment.status) && assignment.dueOn !== null
      )
      for (const assignment of open) {
        const dueOn = resumeDueOn(assignment.dueOn, today)
        if (dueOn === assignment.dueOn) continue
        await TrainingService.updateAssignment(
          assignment.id,
          { dueOn, dueChangeReason: 'Training resumed after a pause' },
          { expectedStatuses: [assignment.status], expectedUpdatedAt: assignment.updatedAt }
        )
        moved += 1
      }
    }
    await TrainingService.upsertProfile(employeeId, { pausedFrom: null, pausedUntil: null, pauseReason: null })
    await recordEventAfterChange({
      eventType: 'resumed',
      employeeId,
      actor: actorOf(user),
      noteCode: started ? 'resumed_by_manager' : 'pause_cancelled',
      meta: { resumedOn: today, dueDatesMoved: moved },
    })
    await audit(user, 'resume', 'training_profile', employeeId, { due_dates_moved: moved, pause_had_started: started })
    revalidateTraining([employeeId])
    return { success: true }
  } catch (error) {
    return failure(error, 'resume')
  }
}

// ---------------------------------------------------------------------------------------------
// Confirmation, sign-off and external qualifications
// ---------------------------------------------------------------------------------------------

/** training:manage. Prepares a new confirmation document after a decline or a failed preparation. */
export async function prepareConfirmationAgain(input: { assignmentId: string }): Promise<TrainingActionResult<{ documentId: string }>> {
  const user = await requireTrainingUser('manage')
  const parsed = z.object({ assignmentId: UuidSchema }).safeParse(input)
  if (!parsed.success) return { error: 'That training item could not be found.' }
  const { assignmentId } = parsed.data
  let assignment: TrainingAssignment
  try {
    assignment = await loadOpenAssignment(assignmentId)
    const course = await TrainingService.getCourseById(assignment.courseId)
    if (!course || course.kind !== 'online') {
      return { error: 'Only an online course has a confirmation to prepare. For a practical sign-off, record it again with them.' }
    }
    if (assignment.status === 'declined') {
      // Back to waiting for confirmation, with the declined document let go, so the daily job
      // retries this one if preparing fails now and never reads the old decline again.
      assignment = await TrainingService.updateAssignment(
        assignmentId,
        { status: 'awaiting_confirmation', signingDocumentId: null },
        { expectedStatuses: ['declined'], expectedUpdatedAt: assignment.updatedAt }
      )
    } else if (assignment.status !== 'awaiting_confirmation') {
      return { error: 'Only a declined confirmation, or one that could not be prepared, can be prepared again.' }
    }
  } catch (error) {
    return failure(error, 'prepare again')
  }

  try {
    // Writes its own confirmation_prepared or confirmation_failed event.
    const { documentId } = await prepareTrainingCertificate(assignmentId)
    await audit(user, 'prepare_confirmation', 'training_assignment', assignmentId, { document_id: documentId })
    revalidateTraining([assignment.employeeId])
    return { success: true, data: { documentId } }
  } catch (error) {
    console.error('Preparing a training confirmation again failed:', error)
    revalidateTraining([assignment.employeeId])
    return { error: 'We could not prepare the confirmation. The daily job will try again, or you can try again later.' }
  }
}

/** Said when a sign-off was saved (and signed for the business) but no in-person link was made here. */
const SIGNOFF_SAVED_SIGN_ELSEWHERE =
  'The sign-off is recorded, but signing could not be started on this device. Open their Signing tab and choose Sign in person.'

/**
 * Why a practical item waiting for confirmation cannot have its sign-off recorded again, or null
 * when it can. It can once its document can no longer be signed: withdrawn on the Signing tab,
 * run out (the 30-day expiry, read from the date even before the daily sweep marks it), declined
 * before the record caught up, or missing. Nothing would ever move such an item on, and
 * createPracticalSignoff makes a new document for the same item. While the document is open the
 * learner can still confirm it; once it is confirmed the record is about to show it as done.
 */
async function signoffRecordRefusal(open: TrainingAssignment): Promise<string | null> {
  if (!open.signingDocumentId) return null
  const status = await TrainingService.getSigningDocumentStatus(open.signingDocumentId)
  if (status !== null && SIGNING_OPEN_STATUSES.includes(status)) return 'This sign-off is already waiting for them to confirm it.'
  if (status === 'completed' || status === 'superseded') {
    return 'They have already confirmed this sign-off, so it does not need recording again. Refresh the page.'
  }
  return null
}

/**
 * After createPracticalSignoff failed with an unexpected error: the new document the item now
 * points at (with the item's `supervisedOnly`) when the sign-off was saved before the failure
 * (for example the item was updated but the reply was lost, and withdrawing the document failed
 * too), so the learner can still sign it; null when it was not saved; and 'unknown' when that
 * could not be read.
 */
async function signoffSavedAnyway(
  before: TrainingAssignment
): Promise<{ documentId: string; supervisedOnly: boolean } | null | 'unknown'> {
  try {
    const now = await TrainingService.getAssignment(before.id)
    if (!now || now.status !== 'awaiting_confirmation' || !now.signingDocumentId) return null
    if (now.signingDocumentId === before.signingDocumentId) return null
    const status = await TrainingService.getSigningDocumentStatus(now.signingDocumentId)
    if (status === null || !SIGNING_OPEN_STATUSES.includes(status)) return null
    return { documentId: now.signingDocumentId, supervisedOnly: now.supervisedOnly }
  } catch (error) {
    console.error('Checking a practical sign-off after it failed did not work:', error)
    return 'unknown'
  }
}

/**
 * training:manage. Records a practical sign-off with the learner beside the manager; returns the
 * in-person URL the learner confirms on.
 *
 * The ticked tasks are checked against the version the item is pinned to (the one the sign-off
 * form lists and the document is made from), or the course's current version for an item not
 * yet pinned. One `signoff_recorded` log line is written, here, with the manager's note and
 * whether the sign-off says "Supervised only" (createPracticalSignoff writes none). Once the
 * sign-off is saved, a failed log line or audit row is logged and the manager is still told it
 * worked, with the in-person link.
 */
export async function recordPracticalSignoff(
  input: PracticalSignoffInput
): Promise<TrainingActionResult<{ assignmentId: string; documentId: string; inPersonUrl: string }>> {
  const user = await requireTrainingUser('manage')
  const parsed = SignoffSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Tick the tasks you watched and choose the date.') }
  const { employeeId, courseId, observedOn, note } = parsed.data
  const tasks = [...new Set(parsed.data.tasks)]
  const today = trainingToday()
  if (observedOn > today) return { error: 'The date you watched them cannot be in the future.' }
  const actor = actorOf(user)

  let assignment: TrainingAssignment
  try {
    const course = await loadLiveCourse(courseId)
    if (course.kind !== 'practical') return { error: `${course.title} is not a practical sign-off.` }

    const person = await loadPerson(employeeId)
    const assignments = await TrainingService.listAssignmentsForEmployee(employeeId)
    const open = assignments.find((cycle) => cycle.courseId === course.id && isOpenStatus(cycle.status))
    if (open?.status === 'waiting' || (!open && !prerequisiteMet(course.prerequisiteCourseId, assignments, today))) {
      return { error: 'This sign-off needs another course finished first.' }
    }
    if (open?.status === 'awaiting_confirmation') {
      const refusal = await signoffRecordRefusal(open)
      if (refusal) return { error: refusal }
    }

    const versionId = open?.versionId ?? course.currentVersionId
    const version = versionId ? await TrainingService.getPublishedVersion(versionId) : null
    if (!version) return { error: `${course.title} has no published version yet.` }
    const courseTasks = version.content.tasks.map((task) => task.key)
    if (tasks.some((task) => !courseTasks.includes(task))) return { error: 'One of those tasks is not part of this course. Refresh and try again.' }
    if (courseTasks.some((task) => !tasks.includes(task))) {
      return { error: 'Every task must be watched before this can be signed off. Tick each one you watched.' }
    }

    if (open) {
      assignment = open
    } else {
      if (person.status !== 'Active') return { error: 'Sign-offs can only be recorded for current staff.' }
      if (!ageRuleAllows(course, person, today)) return { error: `${course.title} is not for this person's age group.` }
      const cycle = nextCycle(assignments, course.id)
      assignment = await TrainingService.createAssignment({
        employeeId,
        courseId: course.id,
        cycle,
        reason: 'manual',
        status: 'assigned',
        assignedOn: today,
        dueOn: null,
      })
      await recordEventAfterChange({
        eventType: 'assigned',
        employeeId,
        courseId: course.id,
        assignmentId: assignment.id,
        actor,
        noteCode: 'manual',
        meta: { cycle, reason: 'manual', status: 'assigned', dueOn: null, forSignoff: true },
      })
    }
  } catch (error) {
    return failure(error, 'sign-off: checks')
  }

  // The log line and audit row for a sign-off that is saved. Never throws: the sign-off stands
  // and the item is already waiting for the learner, so a failure here is logged and the manager
  // is still told it worked (a retry would be refused as "already waiting").
  const recorded = async (saved: { documentId: string; supervisedOnly: boolean }): Promise<void> => {
    const { documentId, supervisedOnly } = saved
    await recordEventAfterChange({
      eventType: 'signoff_recorded',
      employeeId,
      courseId,
      assignmentId: assignment.id,
      actor,
      note: note ?? null,
      meta: { tasks, observedOn, documentId, supervisedOnly },
    })
    try {
      await audit(user, 'signoff', 'training_assignment', assignment.id, { tasks, observed_on: observedOn, document_id: documentId })
    } catch (error) {
      console.error('Practical sign-off saved, but its audit row could not be written:', { assignmentId: assignment.id, documentId, error })
    }
  }

  let signoff: Awaited<ReturnType<typeof createPracticalSignoff>>
  try {
    // When this throws, the new document was withdrawn and the item is as it was, except in the
    // rare case checked below: the item was moved on but the reply was lost.
    signoff =await createPracticalSignoff({ assignmentId: assignment.id, tasks, observedOn, actor })
  } catch (error) {
    revalidateTraining([employeeId])
    if (error instanceof TrainingError) return { error: error.message }
    console.error('Recording a practical sign-off failed:', error)
    const saved = await signoffSavedAnyway(assignment)
    if (saved === 'unknown') {
      return { error: 'The sign-off may not have been recorded. Refresh the page and check before trying again.' }
    }
    if (saved) {
      await recorded(saved)
      return { error: SIGNOFF_SAVED_SIGN_ELSEWHERE }
    }
    return { error: 'The sign-off could not be recorded. Nothing has been signed; please try again.' }
  }

  // From here the sign-off is saved, so nothing below may report it as failed.
  await recorded(signoff)
  revalidateTraining([employeeId])
  if (!signoff.inPersonUrl) return { error: SIGNOFF_SAVED_SIGN_ELSEWHERE }
  return { success: true, data: { assignmentId: assignment.id, documentId: signoff.documentId, inPersonUrl: signoff.inPersonUrl } }
}

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * training:manage. Records an external qualification as completed. Form fields: employeeId,
 * courseId, issuer, reference, issuedOn, expiresOn (optional), file (pdf, jpg or png, at most
 * EXTERNAL_CERTIFICATE_MAX_BYTES, 4 MB: the platform refuses a bigger request, see
 * src/lib/training/upload-limits.ts).
 */
export async function recordExternalQualification(formData: FormData): Promise<TrainingActionResult<{ assignmentId: string }>> {
  const user = await requireTrainingUser('manage')
  const expiresText = formText(formData, 'expiresOn').trim()
  const parsed = ExternalSchema.safeParse({
    employeeId: formText(formData, 'employeeId'),
    courseId: formText(formData, 'courseId'),
    issuer: formText(formData, 'issuer'),
    reference: formText(formData, 'reference'),
    issuedOn: formText(formData, 'issuedOn').trim(),
    expiresOn: expiresText === '' ? null : expiresText,
  })
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Check the qualification details.') }
  const { employeeId, courseId, issuer, issuedOn } = parsed.data
  const reference = parsed.data.reference || null
  const today = trainingToday()
  if (issuedOn > today) return { error: 'The issue date cannot be in the future.' }
  if (parsed.data.expiresOn !== null && parsed.data.expiresOn <= issuedOn) {
    return { error: 'The expiry date must be after the issue date.' }
  }

  const file = formData.get('file')
  if (!(file instanceof Blob) || file.size === 0) return { error: 'Attach the certificate file (PDF, JPG or PNG).' }
  if (file.size > EXTERNAL_CERTIFICATE_MAX_BYTES) {
    return { error: `The certificate file is ${formatMegabytes(file.size)}; the most it can be is ${formatMegabytes(EXTERNAL_CERTIFICATE_MAX_BYTES)}.` }
  }

  try {
    const course = await loadLiveCourse(courseId)
    if (course.kind !== 'external') return { error: `${course.title} is not an external qualification.` }
    const person = await loadPerson(employeeId)
    if (person.status !== 'Active' && person.status !== 'Started Separation') {
      return { error: 'Qualifications can only be recorded for current staff.' }
    }
    const expiresOn = parsed.data.expiresOn ?? computeExpiresOn(course.refresherMonths, issuedOn, null)
    const windowOpensOn = computeWindowOpensOn(expiresOn, course.windowDays)

    // The file first: a record is never saved pointing at a file that is not there.
    const stored = await uploadExternalCertificate({
      employeeId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    })
    const fields = {
      status: 'completed' as const,
      completedOn: issuedOn,
      expiresOn,
      windowOpensOn,
      externalIssuer: issuer,
      externalReference: reference,
      externalIssuedOn: issuedOn,
      externalFilePath: stored.path,
    }

    const assignments = await TrainingService.listAssignmentsForEmployee(employeeId)
    const open = assignments.find((cycle) => cycle.courseId === course.id && isOpenStatus(cycle.status))
    let recorded: TrainingAssignment
    if (open) {
      recorded = await TrainingService.updateAssignment(open.id, fields, {
        expectedStatuses: [open.status],
        expectedUpdatedAt: open.updatedAt,
      })
    } else {
      const renewal = assignments.some((cycle) => cycle.courseId === course.id && cycle.status === 'completed')
      recorded = await TrainingService.createAssignment({
        employeeId,
        courseId: course.id,
        cycle: nextCycle(assignments, course.id),
        reason: renewal ? 'renewal' : 'manual',
        status: 'completed',
        assignedOn: today,
        dueOn: null,
        extra: fields,
      })
    }

    await recordEventAfterChange({
      eventType: 'external_recorded',
      employeeId,
      courseId: course.id,
      assignmentId: recorded.id,
      actor: actorOf(user),
      meta: { issuedOn, expiresOn, hasReference: reference !== null, fileSha256: stored.sha256 },
    })
    await audit(user, 'record_external', 'training_assignment', recorded.id, {
      course_id: course.id,
      issued_on: issuedOn,
      expires_on: expiresOn,
      file_sha256: stored.sha256,
    })
    revalidateTraining([employeeId])
    return { success: true, data: { assignmentId: recorded.id } }
  } catch (error) {
    return failure(error, 'external qualification')
  }
}
