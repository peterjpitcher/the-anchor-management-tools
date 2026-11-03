'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getPortalWorker, getPortalWorkerName, type PortalWorker } from '@/lib/portal/worker'
import { generateCertificateNumber } from '@/lib/training/certificate-number'
import { COURSE_KEY_PATTERN } from '@/lib/training/course-schema'
import { computeExpiresOn, computeWindowOpensOn, londonDateOf, trainingToday } from '@/lib/training/dates'
import { drawQuestions, toCheckQuestionViews } from '@/lib/training/draw'
import { scoreAttempt, toCheckResultItems } from '@/lib/training/scoring'
import { prepareTrainingCertificate } from '@/lib/training/signing'
import {
  allSectionsPassed,
  expiryToExtendFrom,
  isOpenStatus,
  isPausedOn,
  nextSectionKey,
  withCardReached,
  withSectionFailed,
  withSectionPassed,
} from '@/lib/training/states'
import {
  TRAINING_INTRO_KEY,
  TrainingError,
  type Actor,
  type CheckNext,
  type CheckResultView,
  type CourseSection,
  type MyAssignmentView,
  type MyTrainingView,
  type NewTrainingEvent,
  type StartCheckView,
  type TrainingActionResult,
  type TrainingAssignment,
  type TrainingAssignmentPatch,
  type TrainingAssignmentStatus,
  type TrainingCourse,
  type TrainingCourseVersion,
} from '@/lib/training/types'
import { TrainingService } from '@/services/training'

/**
 * Staff portal training actions (build contract section 5.4). No permission module: identity is
 * the signed-in person's own employee record from `getPortalWorker` (src/lib/portal/worker.ts),
 * and every read and write is filtered to that employee. Anything that cannot be confirmed fails
 * closed with a plain error; another person's assignment reads exactly like an unknown one.
 *
 * Marking happens here, on the server: the browser gets questions without answers, sends back the
 * option it showed for each, and only sees answers and explanations once the attempt is recorded.
 *
 * The finish step prepares the certificate pack (a cold Chromium start), so the page that calls
 * `submitTrainingCheck` and `prepareMyConfirmation` must allow 120 seconds (`maxDuration`).
 */

// ---------------------------------------------------------------------------------------------
// Plain words for the person (reading age about 9)
// ---------------------------------------------------------------------------------------------

const MESSAGES = {
  signIn: 'Please sign in with your own staff login to see your training.',
  identityFailed: 'We could not check who you are just now. Please try again in a minute.',
  invalid: 'Something about that request was not right. Please reload the page and try again.',
  notFound: 'We could not find this training.',
  loadFailed: 'Sorry, we could not load your training just now. Please try again in a minute.',
  saveFailed: 'Sorry, something went wrong on our side and this was not saved. Please try again in a minute.',
  notOnline: 'This training is done in person with a manager, not on your phone.',
  notReady: 'This course is not ready yet. A manager will let you know when it is.',
  waiting: 'This training opens when you have finished the course before it.',
  locked: 'This section is locked. A manager will go through it with you and then unlock it.',
  paused: 'Your training is paused at the moment. A manager will tell you when it starts again.',
  awaiting: 'You have passed every section. Confirm your training to finish.',
  declined: 'A manager needs to talk this through with you before you can carry on.',
  completed: 'You have already finished this training.',
  notNeeded: 'You do not need to do this training any more.',
  sectionMissing: 'We could not find this section of the course.',
  sectionPassed: 'You have already passed this section.',
  sectionNotOpen: 'Finish the earlier sections first.',
  cardsFirst: 'Read every card in this section before you start the check.',
  alreadyMarked: 'This check has already been marked. Reload the page to see where you are.',
  notFinished: 'Pass every section first, then you can confirm your training.',
  alreadyConfirmed: 'You have already confirmed this training.',
  confirmFailed: 'We could not prepare your certificate just now. Please try again in a minute.',
  changed: 'Your training changed while you were on this page. Please reload and try again.',
} as const

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

const IdSchema = z.string().uuid()
const SectionKeySchema = z.string().regex(COURSE_KEY_PATTERN)

const SaveProgressSchema = z.object({
  assignmentId: IdSchema,
  sectionKey: z.union([z.literal(TRAINING_INTRO_KEY), SectionKeySchema]),
  card: z.number().int().min(0).max(100),
})

const StartCheckSchema = z.object({ assignmentId: IdSchema, sectionKey: SectionKeySchema })

const SubmitCheckSchema = z.object({
  attemptId: IdSchema,
  answers: z.record(z.string().min(1).max(60), z.number().int().min(0).max(11)),
})

const ConfirmSchema = z.object({ assignmentId: IdSchema })

// ---------------------------------------------------------------------------------------------
// Helpers (not exported: a 'use server' file exports async actions only)
// ---------------------------------------------------------------------------------------------

/** The person's own employee record, or a TrainingError the action turns into plain words. */
async function requireWorker(): Promise<PortalWorker> {
  let worker: PortalWorker | null
  try {
    worker = await getPortalWorker()
  } catch (error) {
    logger.error('Training portal: could not resolve the portal worker', { error: asError(error) })
    throw new TrainingError('unavailable', MESSAGES.identityFailed)
  }
  if (!worker) throw new TrainingError('not_allowed', MESSAGES.signIn)
  return worker
}

/** One of the worker's own cycles. Someone else's reads exactly like an unknown id. */
async function loadOwnAssignment(worker: PortalWorker, assignmentId: string): Promise<TrainingAssignment> {
  const assignment = await TrainingService.getAssignment(assignmentId)
  if (!assignment || assignment.employeeId !== worker.employeeId) {
    throw new TrainingError('not_found', MESSAGES.notFound)
  }
  return assignment
}

async function loadOnlineCourse(assignment: TrainingAssignment): Promise<TrainingCourse> {
  const course = await TrainingService.getCourseById(assignment.courseId)
  if (!course) throw new TrainingError('not_found', MESSAGES.notFound)
  if (course.kind !== 'online') throw new TrainingError('not_allowed', MESSAGES.notOnline)
  return course
}

/**
 * A course whose notes the person can open in the player: online, or practical (read only; its
 * sign-off happens in person, and nothing done while reading it is recorded, because the actions
 * that record progress still use loadOnlineCourse). An external qualification has no notes.
 */
async function loadReadableCourse(assignment: TrainingAssignment): Promise<TrainingCourse> {
  const course = await TrainingService.getCourseById(assignment.courseId)
  if (!course) throw new TrainingError('not_found', MESSAGES.notFound)
  if (course.kind === 'external') throw new TrainingError('not_allowed', MESSAGES.notOnline)
  return course
}

/** The version this cycle is pinned to; it must be a published one. */
async function loadPinnedVersion(versionId: string): Promise<TrainingCourseVersion> {
  const version = await TrainingService.getPublishedVersion(versionId)
  if (!version) throw new TrainingError('unavailable', MESSAGES.notReady)
  return version
}

/**
 * Why the person cannot work on this cycle right now, or null when they can. Only `assigned` and
 * `in_progress` are playable; a pause in force stops an open cycle.
 */
function playableRefusal(status: TrainingAssignmentStatus, paused: boolean): string | null {
  if (paused && isOpenStatus(status)) return MESSAGES.paused
  switch (status) {
    case 'assigned':
    case 'in_progress':
      return null
    case 'waiting':
      return MESSAGES.waiting
    case 'locked':
      return MESSAGES.locked
    case 'awaiting_confirmation':
      return MESSAGES.awaiting
    case 'declined':
      return MESSAGES.declined
    case 'completed':
      return MESSAGES.completed
    case 'waived':
    case 'cancelled':
      return MESSAGES.notNeeded
  }
}

async function refuseUnlessPlayable(assignment: TrainingAssignment): Promise<void> {
  const profile = await TrainingService.getProfile(assignment.employeeId)
  const refusal = playableRefusal(assignment.status, isPausedOn(profile, trainingToday()))
  if (refusal) throw new TrainingError('not_allowed', refusal)
}

function findSection(version: TrainingCourseVersion, sectionKey: string): CourseSection {
  const section = version.content.sections.find((candidate) => candidate.key === sectionKey)
  if (!section) throw new TrainingError('not_found', MESSAGES.sectionMissing)
  return section
}

function sectionKeysOf(version: TrainingCourseVersion): string[] {
  return version.content.sections.map((section) => section.key)
}

/**
 * Writes a change to one cycle, guarded on the status and `updated_at` it was read with, so two
 * tabs (or a tab and the daily job) cannot both move it. On a clash it reads the row again and
 * works the change out afresh from what is there now (at most three tries). `compute` returns
 * null when nothing needs writing, and may throw a TrainingError when the fresh row no longer
 * allows the change.
 */
async function moveAssignment(
  initial: TrainingAssignment,
  expectedStatuses: readonly TrainingAssignmentStatus[],
  compute: (current: TrainingAssignment) => TrainingAssignmentPatch | null
): Promise<{ before: TrainingAssignment; after: TrainingAssignment; changed: boolean }> {
  let current = initial
  for (let tryNo = 1; ; tryNo += 1) {
    const patch = compute(current)
    if (!patch) return { before: current, after: current, changed: false }
    try {
      const after = await TrainingService.updateAssignment(current.id, patch, {
        expectedStatuses,
        expectedUpdatedAt: current.updatedAt,
      })
      return { before: current, after, changed: true }
    } catch (error) {
      if (!(error instanceof TrainingError && error.code === 'conflict') || tryNo >= 3) throw error
      const fresh = await TrainingService.getAssignment(current.id)
      if (!fresh || fresh.employeeId !== initial.employeeId) throw new TrainingError('not_found', MESSAGES.notFound)
      current = fresh
    }
  }
}

/** The learner as the actor on their own events: their user id and their name at the time. */
async function selfActor(worker: PortalWorker): Promise<Actor> {
  try {
    return { id: worker.userId, name: (await getPortalWorkerName(worker.employeeId)) ?? 'Staff member' }
  } catch (error) {
    logger.error('Training portal: could not read the worker name for an event', {
      error: asError(error),
      metadata: { employeeId: worker.employeeId },
    })
    return { id: worker.userId, name: 'Staff member' }
  }
}

/**
 * Appends events after the change they describe has been saved. The attempt and the assignment
 * are the record the person depends on, so a failed log write is logged loudly but does not turn
 * a saved result into an error screen.
 */
async function writeEvents(events: NewTrainingEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await TrainingService.writeEvent(event)
    } catch (error) {
      logger.error('Training portal: could not write a training event', {
        error: asError(error),
        metadata: { eventType: event.eventType, assignmentId: event.assignmentId ?? null, employeeId: event.employeeId ?? null },
      })
    }
  }
}

/** The previous completed cycle's expiry, so finishing early extends from it (spec 4.3). */
async function previousExpiresOn(assignment: TrainingAssignment, refresherMonths: number | null): Promise<string | null> {
  const cycles = await TrainingService.listAssignmentsForEmployee(assignment.employeeId)
  return expiryToExtendFrom(
    cycles.filter((cycle) => cycle.courseId === assignment.courseId),
    assignment.cycle,
    refresherMonths
  )
}

/** My Training and the player page for one cycle. */
function revalidateMyTraining(assignmentId: string): void {
  revalidatePath('/portal/training')
  revalidatePath(`/portal/training/${assignmentId}`)
}

function confirmUrlFor(partyId: string): string {
  return `/portal/documents/${partyId}`
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** A refusal in plain words; anything unexpected is logged and answered with `fallback`. */
function failure(action: string, error: unknown, fallback: string): { error: string } {
  if (error instanceof TrainingError) return { error: error.message }
  logger.error(`Training portal: ${action} failed`, { error: asError(error) })
  return { error: fallback }
}

/**
 * The player view with every section rebuilt field by field, so nothing beyond cards and
 * objectives (questions, answers, explanations) can reach the browser whatever the service
 * returns.
 */
function withoutQuestions(view: MyAssignmentView): MyAssignmentView {
  const { course } = view
  return {
    assignmentId: view.assignmentId,
    courseId: view.courseId,
    status: view.status,
    state: view.state,
    dueOn: view.dueOn,
    course: {
      versionId: course.versionId,
      versionLabel: course.versionLabel,
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      kind: course.kind,
      estimatedMinutes: course.estimatedMinutes,
      intro: course.intro,
      sections: course.sections.map((section) => ({
        key: section.key,
        title: section.title,
        objectives: section.objectives.map((objective) => ({ key: objective.key, text: objective.text })),
        cards: section.cards,
        resitNote: section.resitNote,
        questionsPerAttempt: section.questionsPerAttempt,
        maxWrong: section.maxWrong,
      })),
      closing: course.closing,
      imageBaseUrl: course.imageBaseUrl,
    },
    progress: view.progress,
    sectionStates: view.sectionStates,
    lockedSection: view.lockedSection,
    confirmation: { state: view.confirmation.state, confirmUrl: view.confirmation.confirmUrl },
  }
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/** Runs `syncAssignments({ employeeId: self })`, then lists what is due, waiting and done. */
export async function getMyTraining(): Promise<TrainingActionResult<MyTrainingView>> {
  try {
    const worker = await requireWorker()
    // A failed sync fails the page: a list that might be missing new training must never be
    // shown as if it were complete.
    await TrainingService.syncAssignments({ employeeId: worker.employeeId })
    const view = await TrainingService.getMyTraining(worker.employeeId)
    return { success: true, data: view }
  } catch (error) {
    return failure('getMyTraining', error, MESSAGES.loadFailed)
  }
}

/**
 * One of my cycles in the player: course details, intro, section titles and cards (no questions),
 * progress, version. A practical course comes back too, so its notes can be read.
 */
export async function getMyAssignment(assignmentId: string): Promise<TrainingActionResult<MyAssignmentView>> {
  const parsed = IdSchema.safeParse(assignmentId)
  if (!parsed.success) return { error: MESSAGES.notFound }
  try {
    const worker = await requireWorker()
    const assignment = await loadOwnAssignment(worker, parsed.data)
    await loadReadableCourse(assignment)
    const view = await TrainingService.getMyAssignment(worker.employeeId, assignment.id)
    if (!view || view.assignmentId !== assignment.id) return { error: MESSAGES.notFound }
    return { success: true, data: withoutQuestions(view) }
  } catch (error) {
    return failure('getMyAssignment', error, MESSAGES.loadFailed)
  }
}

/**
 * Saves the card reached in a section (on each Next). The first save of a cycle sets
 * `started_at`, fixes the version and writes a `started` event. Pass `TRAINING_INTRO_KEY` as
 * `sectionKey` to record the intro cards as seen.
 */
export async function saveTrainingProgress(input: {
  assignmentId: string
  sectionKey: string
  card: number
}): Promise<TrainingActionResult> {
  const parsed = SaveProgressSchema.safeParse(input)
  if (!parsed.success) return { error: MESSAGES.invalid }
  const { assignmentId, sectionKey, card } = parsed.data
  try {
    const worker = await requireWorker()
    const assignment = await loadOwnAssignment(worker, assignmentId)
    await loadOnlineCourse(assignment)
    await refuseUnlessPlayable(assignment)

    // The version is fixed at the first start and kept for the cycle.
    const version = assignment.versionId
      ? await loadPinnedVersion(assignment.versionId)
      : await TrainingService.getCurrentVersion(assignment.courseId)
    if (!version || version.state !== 'published') throw new TrainingError('unavailable', MESSAGES.notReady)
    const sectionKeys = sectionKeysOf(version)
    const section = sectionKey === TRAINING_INTRO_KEY ? null : findSection(version, sectionKey)
    const now = new Date().toISOString()

    const cardCount = section ? section.cards.length : version.content.intro.length

    const { before, after, changed } = await moveAssignment(assignment, ['assigned', 'in_progress'], (current) => {
      if (current.versionId && current.versionId !== version.id) throw new TrainingError('conflict', MESSAGES.changed)
      const patch: TrainingAssignmentPatch = {}
      // A passed section can be read again; going back through it changes nothing.
      const progress = withCardReached(current.progress, { sectionKeys, sectionKey, card, cardCount })
      if (JSON.stringify(progress) !== JSON.stringify(current.progress)) patch.progress = progress
      if (!current.versionId) patch.versionId = version.id
      if (!current.startedAt) patch.startedAt = now
      if (current.status === 'assigned') patch.status = 'in_progress'
      return Object.keys(patch).length > 0 ? patch : null
    })

    if (changed && !before.startedAt && after.startedAt) {
      await writeEvents([
        {
          eventType: 'started',
          employeeId: worker.employeeId,
          assignmentId: assignment.id,
          courseId: assignment.courseId,
          actor: await selfActor(worker),
          meta: { versionId: version.id, major: version.major ?? 0, minor: version.minor ?? 0 },
        },
      ])
      revalidateMyTraining(assignment.id)
    }
    return { success: true }
  } catch (error) {
    return failure('saveTrainingProgress', error, MESSAGES.saveFailed)
  }
}

/**
 * Starts the check for an open section, or returns the attempt already open for it (same
 * questions), so reloading cannot fish for easier ones. Questions in displayed order, no answers.
 */
export async function startTrainingCheck(input: {
  assignmentId: string
  sectionKey: string
}): Promise<TrainingActionResult<StartCheckView>> {
  const parsed = StartCheckSchema.safeParse(input)
  if (!parsed.success) return { error: MESSAGES.invalid }
  const { assignmentId, sectionKey } = parsed.data
  try {
    const worker = await requireWorker()
    const assignment = await loadOwnAssignment(worker, assignmentId)
    await loadOnlineCourse(assignment)
    await refuseUnlessPlayable(assignment)
    // Nothing saved yet means no card has been read.
    if (!assignment.versionId) throw new TrainingError('not_allowed', MESSAGES.cardsFirst)

    const version = await loadPinnedVersion(assignment.versionId)
    const section = findSection(version, sectionKey)
    const progress = assignment.progress
    if (progress.sections[section.key]?.passedAt) throw new TrainingError('not_allowed', MESSAGES.sectionPassed)
    if (nextSectionKey(progress, sectionKeysOf(version)) !== section.key) {
      throw new TrainingError('not_allowed', MESSAGES.sectionNotOpen)
    }
    const reached = progress.sections[section.key]?.card ?? -1
    if (reached < section.cards.length - 1) throw new TrainingError('not_allowed', MESSAGES.cardsFirst)

    const open = await TrainingService.getOpenAttempt(assignment.id, section.key)
    if (open) {
      return {
        success: true,
        data: { attemptId: open.id, attemptNo: open.attemptNo, questions: toCheckQuestionViews(section, open.served) },
      }
    }

    // A new draw never repeats the previous attempt's questions when the pool allows.
    const earlier = (await TrainingService.listAttempts(assignment.id))
      .filter((attempt) => attempt.sectionKey === section.key)
      .sort((a, b) => b.attemptNo - a.attemptNo)
    const last = earlier[0] ?? null
    const served = drawQuestions({
      section,
      previousQuestionIds: last ? last.served.map((question) => question.questionId) : [],
    })

    try {
      const attempt = await TrainingService.createAttempt({
        assignmentId: assignment.id,
        employeeId: worker.employeeId,
        versionId: version.id,
        sectionKey: section.key,
        attemptNo: (last?.attemptNo ?? 0) + 1,
        served,
      })
      return {
        success: true,
        data: { attemptId: attempt.id, attemptNo: attempt.attemptNo, questions: toCheckQuestionViews(section, attempt.served) },
      }
    } catch (error) {
      // Another tab opened the check first: hand back that one, never a second draw.
      if (!(error instanceof TrainingError && error.code === 'conflict')) throw error
      const winner = await TrainingService.getOpenAttempt(assignment.id, section.key)
      if (!winner) throw error
      return {
        success: true,
        data: { attemptId: winner.id, attemptNo: winner.attemptNo, questions: toCheckQuestionViews(section, winner.served) },
      }
    }
  } catch (error) {
    return failure('startTrainingCheck', error, MESSAGES.saveFailed)
  }
}

/**
 * Submits a check. `answers` maps question id to the DISPLAYED option index. Marks it on the
 * server, records the attempt, moves progress on, locks on the third fail, and on the last pass
 * stores completion and prepares the confirmation (`next: 'confirm'` with `confirmUrl`, or
 * `'confirm_retry'` when preparing failed).
 */
export async function submitTrainingCheck(input: {
  attemptId: string
  answers: Record<string, number>
}): Promise<TrainingActionResult<CheckResultView>> {
  const parsed = SubmitCheckSchema.safeParse(input)
  if (!parsed.success) return { error: MESSAGES.invalid }
  const { attemptId, answers } = parsed.data
  try {
    const worker = await requireWorker()
    const attempt = await TrainingService.getAttempt(attemptId)
    if (!attempt || attempt.employeeId !== worker.employeeId) throw new TrainingError('not_found', MESSAGES.notFound)
    if (attempt.submittedAt) throw new TrainingError('conflict', MESSAGES.alreadyMarked)

    const assignment = await loadOwnAssignment(worker, attempt.assignmentId)
    const course = await loadOnlineCourse(assignment)
    // A pause stops new checks (startTrainingCheck); a check already open can still be handed in.
    const refusal = playableRefusal(assignment.status, false)
    if (refusal) throw new TrainingError('not_allowed', refusal)
    if (assignment.status !== 'in_progress' || assignment.versionId !== attempt.versionId) {
      throw new TrainingError('conflict', MESSAGES.changed)
    }

    const version = await loadPinnedVersion(attempt.versionId)
    const section = findSection(version, attempt.sectionKey)
    const sectionKeys = sectionKeysOf(version)
    if (nextSectionKey(assignment.progress, sectionKeys) !== section.key) throw new TrainingError('conflict', MESSAGES.changed)

    const outcome = scoreAttempt({ section, served: attempt.served, answers })
    const now = new Date().toISOString()

    // The attempt is updated once, and first: its `submitted_at` is what stops a second submit.
    await TrainingService.submitAttempt(attempt.id, {
      submittedAt: now,
      answers: outcome.answers,
      results: outcome.results,
      wrongCount: outcome.wrongCount,
      criticalMissed: outcome.criticalMissed,
      passed: outcome.passed,
    })

    const questionIds = attempt.served.map((question) => question.questionId)
    const priorExpiry = outcome.passed ? await previousExpiresOn(assignment, course.refresherMonths) : null
    let fails = 0
    let locked = false
    let finished = false

    // If this write fails after the attempt is recorded, the attempt stays as evidence and the
    // person takes a new check; nothing is counted twice.
    const { after } = await moveAssignment(assignment, ['in_progress'], (current) => {
      if (current.status !== 'in_progress') throw new TrainingError('conflict', MESSAGES.changed)
      if (outcome.passed) {
        const progress = withSectionPassed(current.progress, { sectionKeys, sectionKey: section.key, passedAt: now, questionIds })
        const patch: TrainingAssignmentPatch = { progress, lastSectionPassedAt: now }
        finished = allSectionsPassed(progress, sectionKeys)
        if (finished) {
          // Completion is stored before the pack is made, so the certificate and the record agree.
          const completedOn = londonDateOf(now)
          const expiresOn = computeExpiresOn(course.refresherMonths, completedOn, priorExpiry)
          patch.status = 'awaiting_confirmation'
          patch.completedOn = completedOn
          patch.expiresOn = expiresOn
          patch.windowOpensOn = computeWindowOpensOn(expiresOn, course.windowDays)
          // A fresh number on every try, so a (vanishingly rare) clash on the unique column clears.
          patch.certificateNumber = generateCertificateNumber()
        }
        return patch
      }
      const failed = withSectionFailed(current.progress, { sectionKey: section.key, questionIds })
      fails = failed.fails
      locked = failed.locked
      const patch: TrainingAssignmentPatch = { progress: failed.progress }
      if (locked) {
        patch.status = 'locked'
        patch.lockedAt = now
        patch.lockedSection = section.key
      }
      return patch
    })

    const actor = await selfActor(worker)
    const base = { employeeId: worker.employeeId, assignmentId: assignment.id, courseId: assignment.courseId, actor }
    const attemptMeta = {
      sectionKey: section.key,
      attemptNo: attempt.attemptNo,
      attemptId: attempt.id,
      wrongCount: outcome.wrongCount,
      criticalMissed: outcome.criticalMissed,
    }
    if (outcome.passed) {
      await writeEvents([{ ...base, eventType: 'section_passed', meta: { ...attemptMeta, finished } }])
    } else {
      const events: NewTrainingEvent[] = [{ ...base, eventType: 'section_failed', meta: { ...attemptMeta, fails } }]
      if (locked) events.push({ ...base, eventType: 'locked', meta: { sectionKey: section.key, fails } })
      await writeEvents(events)
    }

    let next: CheckNext = outcome.passed ? 'next_section' : locked ? 'locked' : 'retry'
    let confirmUrl: string | undefined
    if (finished) {
      try {
        const prepared = await prepareTrainingCertificate(after.id)
        next = 'confirm'
        confirmUrl = confirmUrlFor(prepared.partyId)
      } catch (error) {
        // The pass is saved and the daily job retries; the person sees a friendly "try again".
        logger.error('Training portal: certificate preparation failed after the last section', {
          error: asError(error),
          metadata: { assignmentId: after.id },
        })
        next = 'confirm_retry'
      }
    }

    revalidateMyTraining(assignment.id)
    return {
      success: true,
      data: {
        passed: outcome.passed,
        wrongCount: outcome.wrongCount,
        criticalMissed: outcome.criticalMissed,
        maxWrong: section.check.maxWrong,
        results: toCheckResultItems(section, attempt.served, outcome),
        next,
        ...(confirmUrl ? { confirmUrl } : {}),
      },
    }
  } catch (error) {
    return failure('submitTrainingCheck', error, MESSAGES.saveFailed)
  }
}

/** Prepares (or finds) my confirmation document and returns `/portal/documents/<partyId>`. */
export async function prepareMyConfirmation(input: { assignmentId: string }): Promise<TrainingActionResult<{ confirmUrl: string }>> {
  const parsed = ConfirmSchema.safeParse(input)
  if (!parsed.success) return { error: MESSAGES.invalid }
  try {
    const worker = await requireWorker()
    const assignment = await loadOwnAssignment(worker, parsed.data.assignmentId)
    await loadOnlineCourse(assignment)
    switch (assignment.status) {
      case 'awaiting_confirmation':
        break
      case 'completed':
        throw new TrainingError('not_allowed', MESSAGES.alreadyConfirmed)
      case 'declined':
        throw new TrainingError('not_allowed', MESSAGES.declined)
      case 'waived':
      case 'cancelled':
        throw new TrainingError('not_allowed', MESSAGES.notNeeded)
      default:
        throw new TrainingError('not_allowed', MESSAGES.notFinished)
    }

    try {
      const prepared = await prepareTrainingCertificate(assignment.id)
      revalidateMyTraining(assignment.id)
      return { success: true, data: { confirmUrl: confirmUrlFor(prepared.partyId) } }
    } catch (error) {
      logger.error('Training portal: certificate preparation failed on request', {
        error: asError(error),
        metadata: { assignmentId: assignment.id },
      })
      return { error: MESSAGES.confirmFailed }
    }
  } catch (error) {
    return failure('prepareMyConfirmation', error, MESSAGES.saveFailed)
  }
}
