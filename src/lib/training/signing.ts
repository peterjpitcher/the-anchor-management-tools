import { isValidIsoDate } from '@/lib/dateUtils'
import { hasLeft } from '@/lib/employees/current-staff'
import { legalName } from '@/lib/employees/display-name'
import { logger } from '@/lib/logger'
import {
  buildTrainingCertificateSource,
  trainingCertificateTitle,
  type TrainingRecordSection,
} from '@/lib/signing/documents/training-certificate'
import { buildTrainingSignoffSource, trainingSignoffTitle } from '@/lib/signing/documents/training-signoff'
import { getSigningKind } from '@/lib/signing/kinds'
import { prepareSigningDocument } from '@/lib/signing/prepare'
import { createSigningRequest, startInPersonSigning, voidSigningDocument } from '@/lib/signing/service'
import { readTrainingSigningContext, type TrainingSigningContext } from '@/lib/signing/training-wording'
import { SIGNING_OPEN_STATUSES, type SigningDocumentStatus, type SigningKind } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { TrainingService } from '@/services/training'
import { generateCertificateNumber } from './certificate-number'
import { ageOn, computeExpiresOn, computeWindowOpensOn, londonDateOf, trainingToday } from './dates'
import { expiryToExtendFrom } from './states'
import { signoffMinimumAgeRefusal } from './sync'
import { formatTrainingVersion } from './labels'
import {
  SYSTEM_ACTOR,
  TrainingError,
  type NewTrainingEvent,
  type SignoffTaskRecord,
  type StaffActor,
  type TrainingAssignment,
  type TrainingAssignmentStatus,
  type TrainingCourse,
  type TrainingCourseVersion,
  type TrainingEventMeta,
} from './types'

/**
 * Training through the shared signing feature (build contract section 4). A finished online
 * course is confirmed as a `training_completion` document (the certificate pack); a practical
 * sign-off is a `training_signoff` document the manager signs as the business and the learner
 * confirms in person. No training table holds a signature of its own: the training item only
 * points at its signing document (`signing_document_id`) and is moved on by the two hooks below.
 *
 * Both kinds are made with `sendLinkEmails: false`. The learner confirms a certificate in the
 * staff portal (the training emails take them there) and a sign-off on the manager's device, so
 * the signing feature's own link emails and reminders are never used (they are switched off for
 * both kinds in src/lib/signing/kinds.ts). The training daily job is the only chaser.
 */

/** Series per course, so a refresher's document supersedes the last one once it is signed. */
function trainingCertificateSeriesKey(courseSlug: string): string {
  return `training:${courseSlug}`
}

function trainingSignoffSeriesKey(courseSlug: string): string {
  return `training-signoff:${courseSlug}`
}

/** Statuses a certificate pack may be prepared from. Declined goes back to awaiting. */
const PREPARE_FROM: readonly TrainingAssignmentStatus[] = ['awaiting_confirmation', 'declined']

/** Statuses a practical sign-off may be recorded from. */
const SIGNOFF_FROM: readonly TrainingAssignmentStatus[] = ['assigned', 'in_progress', 'awaiting_confirmation', 'declined']

/** A document that is still with the learner (sent, or signed for the business only). */
const OPEN_STATUSES: readonly SigningDocumentStatus[] = SIGNING_OPEN_STATUSES

/** Signing documents whose signing is over (a completed one may later be superseded by the next). */
const DONE_STATUSES: readonly SigningDocumentStatus[] = ['completed', 'superseded']

interface EmployeeForSigning {
  employee_id: string
  first_name: string | null
  last_name: string | null
  email_address: string | null
  date_of_birth: string | null
  status: string | null
  employment_end_date: string | null
}

interface DocumentForTraining {
  id: string
  kind: SigningKind
  status: SigningDocumentStatus
  series_key: string
  expires_at: string | null
  completed_at: string | null
  context: Record<string, unknown>
}

type AdminClient = ReturnType<typeof createAdminClient>

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function errorCode(value: unknown): string {
  if (value instanceof TrainingError) return value.code
  if (value && typeof value === 'object' && typeof (value as { code?: unknown }).code === 'string') {
    return (value as { code: string }).code
  }
  return 'error'
}

/** Writes an event; a failed write is reported, never thrown, so the change it records stands. */
async function writeEventSafely(event: NewTrainingEvent, what: string): Promise<void> {
  try {
    await TrainingService.writeEvent(event)
  } catch (error) {
    logger.error(`Training signing: ${what}, but its training log line could not be written`, {
      error: asError(error),
      metadata: { eventType: event.eventType, assignmentId: event.assignmentId ?? null },
    })
  }
}

async function loadEmployee(admin: AdminClient, employeeId: string): Promise<EmployeeForSigning> {
  const { data, error } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, date_of_birth, status, employment_end_date')
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the employee: ${error.message}`)
  if (!data) throw new TrainingError('not_found', 'That person could not be found.')
  const employee = data as EmployeeForSigning
  // Former, or on notice and past their last working day.
  if (hasLeft(employee)) throw new TrainingError('not_allowed', 'They no longer work here.')
  return employee
}

/** The name printed on the document and agreed to: the full legal name on their record. */
function learnerNameOf(employee: EmployeeForSigning): string {
  const name = legalName(employee, '')
  if (!name) throw new TrainingError('not_ready', 'Add their name to the employee record first.')
  return name
}

async function loadCourse(assignment: TrainingAssignment): Promise<TrainingCourse> {
  const course = await TrainingService.getCourseById(assignment.courseId)
  if (!course) throw new TrainingError('not_found', 'That course could not be found.')
  return course
}

function versionLabelOf(version: Pick<TrainingCourseVersion, 'major' | 'minor'>): string | null {
  return version.major !== null && version.minor !== null ? formatTrainingVersion(version.major, version.minor) : null
}

async function loadDocument(admin: AdminClient, documentId: string): Promise<DocumentForTraining | null> {
  const { data, error } = await admin
    .from('signing_documents')
    .select('id, kind, status, series_key, expires_at, completed_at, context')
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the signing document: ${error.message}`)
  if (!data) return null
  const row = data as Omit<DocumentForTraining, 'context'> & { context: unknown }
  return { ...row, context: (row.context && typeof row.context === 'object' ? row.context : {}) as Record<string, unknown> }
}

/** The learner's party on a training document. */
async function loadWorkerParty(
  admin: AdminClient,
  documentId: string
): Promise<{ id: string; status: string; declined_at: string | null } | null> {
  const { data, error } = await admin
    .from('signing_parties')
    .select('id, status, declined_at')
    .eq('document_id', documentId)
    .eq('role', 'worker')
    .limit(1)
  if (error) throw new Error(`Could not read who signs the document: ${error.message}`)
  const row = ((data ?? []) as Array<{ id: string; status: string; declined_at: string | null }>)[0]
  return row ?? null
}

/** Still with the learner and not past its link expiry, so it can be offered again. */
function isLiveDocument(document: Pick<DocumentForTraining, 'status' | 'expires_at'>, now: Date): boolean {
  if (!OPEN_STATUSES.includes(document.status)) return false
  if (!document.expires_at) return true
  const expires = new Date(document.expires_at).getTime()
  return Number.isFinite(expires) && expires > now.getTime()
}

function belongsTo(document: Pick<DocumentForTraining, 'context'>, assignmentId: string): boolean {
  return readTrainingSigningContext(document.context)?.assignment_id === assignmentId
}

// ---------------------------------------------------------------------------------------------
// Certificate pack (online courses)
// ---------------------------------------------------------------------------------------------

/**
 * The document for this item that the learner can still confirm, or that they already have:
 * the one the item points at, or, when the item lost its link (a write that failed after the
 * document was made), the newest in the course's series made for this item.
 */
async function findCertificateDocument(
  admin: AdminClient,
  assignment: TrainingAssignment,
  seriesKey: string,
  now: Date
): Promise<DocumentForTraining | null> {
  if (assignment.signingDocumentId) {
    const linked = await loadDocument(admin, assignment.signingDocumentId)
    if (linked && linked.kind === 'training_completion' && isLiveDocument(linked, now)) return linked
  }
  const { data, error } = await admin
    .from('signing_documents')
    .select('id, kind, status, series_key, expires_at, completed_at, context')
    .eq('subject_type', 'employee')
    .eq('subject_id', assignment.employeeId)
    .eq('series_key', seriesKey)
    .in('status', [...OPEN_STATUSES, ...DONE_STATUSES])
    .order('version', { ascending: false })
    .limit(20)
  if (error) throw new Error(`Could not read earlier certificates: ${error.message}`)
  const candidates = ((data ?? []) as Array<Omit<DocumentForTraining, 'context'> & { context: unknown }>)
    .map((row) => ({ ...row, context: (row.context && typeof row.context === 'object' ? row.context : {}) as Record<string, unknown> }))
    .filter((row) => row.kind === 'training_completion' && belongsTo(row, assignment.id))
  // A confirmed one wins: the learner has already done this, and must not be asked again.
  return (
    candidates.find((row) => DONE_STATUSES.includes(row.status)) ??
    candidates.find((row) => isLiveDocument(row, now)) ??
    null
  )
}

/** What the certificate's training record page lists for each section. */
async function recordSections(assignment: TrainingAssignment, version: TrainingCourseVersion): Promise<TrainingRecordSection[]> {
  const attempts = (await TrainingService.listAttempts(assignment.id)).filter((attempt) => attempt.submittedAt !== null)
  return version.content.sections.map((section) => {
    const taken = attempts.filter((attempt) => attempt.sectionKey === section.key).sort((a, b) => a.attemptNo - b.attemptNo)
    const passedAt = assignment.progress.sections[section.key]?.passedAt ?? taken.find((attempt) => attempt.passed)?.submittedAt ?? null
    return {
      title: section.title,
      checksTaken: taken.length,
      passedOn: passedAt ? londonDateOf(passedAt) : null,
      passedFirstTime: taken[0]?.passed === true,
    }
  })
}

/**
 * Points the item at `documentId` (and takes a declined item back to awaiting), guarded on the
 * row as read. Returns false when the row moved on in the meantime.
 */
async function linkCertificate(assignment: TrainingAssignment, documentId: string): Promise<boolean> {
  if (assignment.signingDocumentId === documentId && assignment.status === 'awaiting_confirmation') return true
  try {
    await TrainingService.updateAssignment(
      assignment.id,
      { signingDocumentId: documentId, status: 'awaiting_confirmation', declinedAt: null },
      { expectedStatuses: [assignment.status], expectedUpdatedAt: assignment.updatedAt }
    )
    return true
  } catch (error) {
    if (error instanceof TrainingError && error.code === 'conflict') return false
    throw error
  }
}

/** How many times a lost link race is read again before the preparation gives up. */
const LINK_ATTEMPTS = 3

/**
 * Uses a document that already exists for this item. A confirmed one completes the item (its
 * hook did not get there); a live one is linked and returned. Null when there is none.
 *
 * When linking loses to another write (an overlapping preparation linking the same item), the
 * item is read again and the search repeated, so both callers settle on the same document rather
 * than one of them making a competing one. Throws `conflict` if the item keeps moving.
 */
async function reuseCertificate(
  admin: AdminClient,
  assignment: TrainingAssignment,
  seriesKey: string,
  now: Date
): Promise<{ documentId: string; partyId: string } | null> {
  let current = assignment
  for (let attempt = 1; attempt <= LINK_ATTEMPTS; attempt += 1) {
    const existing = await findCertificateDocument(admin, current, seriesKey, now)
    if (!existing) return null
    const party = await loadWorkerParty(admin, existing.id)
    if (!party) return null
    if (DONE_STATUSES.includes(existing.status)) {
      await completeFromDocument(current, existing)
      return { documentId: existing.id, partyId: party.id }
    }
    if (await linkCertificate(current, existing.id)) return { documentId: existing.id, partyId: party.id }
    current = await rereadForCertificate(current.id)
  }
  throw new TrainingError('conflict', 'This training item changed while the certificate was being made.')
}

/** Reads the item again, refusing one that can no longer be prepared. */
async function rereadForCertificate(assignmentId: string): Promise<TrainingAssignment> {
  const current = await TrainingService.getAssignment(assignmentId)
  if (!current) throw new TrainingError('not_found', 'That training item could not be found.')
  if (current.status === 'completed') throw new TrainingError('not_allowed', 'This training is already confirmed.')
  if (!PREPARE_FROM.includes(current.status)) {
    throw new TrainingError('conflict', 'This training item changed while the certificate was being made.')
  }
  return current
}

/**
 * True while the item still points at `documentId` and that document still stands (open, or
 * already confirmed). False when an overlapping preparation has replaced it since.
 */
async function stillStandsFor(admin: AdminClient, assignmentId: string, documentId: string): Promise<boolean> {
  let current: TrainingAssignment | null
  let document: DocumentForTraining | null
  try {
    current = await TrainingService.getAssignment(assignmentId)
    if (!current || current.signingDocumentId !== documentId) return false
    document = await loadDocument(admin, documentId)
  } catch (error) {
    // The link itself was written, so ours stood a moment ago. A check that cannot be read is no
    // reason to fail a preparation that worked; the portal reads the linked document on reload.
    logger.error('Training signing: could not re-check a certificate just linked; using it', {
      error: asError(error),
      metadata: { assignmentId, documentId },
    })
    return true
  }
  return document !== null && (isLiveDocument(document, new Date()) || DONE_STATUSES.includes(document.status))
}

/**
 * Prepares the certificate pack for an assignment in `awaiting_confirmation` whose
 * `completed_on`, `expires_on` and `certificate_number` are already stored. Idempotent: returns
 * the open document when one exists. Series key `training:<slug>`, `sendLinkEmails: false`, the
 * learner's email on the party. Sets `training_assignments.signing_document_id` and writes a
 * `confirmation_prepared` event; on failure writes `confirmation_failed` and throws, leaving the
 * status as it is so the daily job retries. Needs room for a cold Chromium start (120 seconds).
 *
 * A declined item may be prepared again (the learner changed their mind): it goes back to
 * awaiting confirmation with a new document.
 *
 * Overlapping calls (a reload and Try again during a slow render, or the daily job) settle on one
 * document: the search for an existing one is repeated after the render, a lost link race is read
 * again, and once linked the item is checked once more, so a caller hands back the document that
 * stands for the item rather than one a newer document in the series has withdrawn. What is left
 * is two calls creating within the same moment (well under a second, no render between); the
 * learner's portal then reads the linked document on reload.
 */
export async function prepareTrainingCertificate(assignmentId: string): Promise<{ documentId: string; partyId: string }> {
  const assignment = await TrainingService.getAssignment(assignmentId)
  if (!assignment) throw new TrainingError('not_found', 'That training item could not be found.')
  if (assignment.status === 'completed') throw new TrainingError('not_allowed', 'This training is already confirmed.')
  if (!PREPARE_FROM.includes(assignment.status)) {
    throw new TrainingError('not_ready', 'The course is not finished yet, so there is nothing to confirm.')
  }

  const event = { employeeId: assignment.employeeId, assignmentId: assignment.id, courseId: assignment.courseId, actor: SYSTEM_ACTOR }
  let stage = 'check'
  try {
    const course = await loadCourse(assignment)
    if (course.kind !== 'online') throw new TrainingError('invalid', 'Only an online course has a certificate to confirm.')
    if (!assignment.completedOn || !assignment.certificateNumber || !assignment.versionId) {
      throw new TrainingError('not_ready', 'The course result is not fully recorded yet.')
    }
    const admin = createAdminClient()
    const seriesKey = trainingCertificateSeriesKey(course.slug)
    const now = new Date()

    stage = 'reuse'
    const reused = await reuseCertificate(admin, assignment, seriesKey, now)
    if (reused) return reused

    stage = 'build'
    const employee = await loadEmployee(admin, assignment.employeeId)
    const learnerName = learnerNameOf(employee)
    const version = await TrainingService.getPublishedVersion(assignment.versionId)
    if (!version) throw new TrainingError('not_ready', 'The version of the course they took could not be found.')
    const versionLabel = versionLabelOf(version)
    const source = buildTrainingCertificateSource({
      holderName: learnerName,
      courseTitle: course.title,
      versionLabel,
      certificateNumber: assignment.certificateNumber,
      completedOn: assignment.completedOn,
      expiresOn: assignment.expiresOn,
      startedOn: assignment.startedAt ? londonDateOf(assignment.startedAt) : null,
      contentSha256: version.contentSha256,
      sections: await recordSections(assignment, version),
    })
    const title = trainingCertificateTitle(course.title, versionLabel)
    const training: TrainingSigningContext = {
      assignment_id: assignment.id,
      course_id: course.id,
      course_slug: course.slug,
      course_title: course.title,
      version_label: versionLabel,
      certificate_number: assignment.certificateNumber,
      cycle: assignment.cycle,
      learner_name: learnerName,
    }

    stage = 'render'
    const prepared = await prepareSigningDocument({
      source,
      mode: getSigningKind('training_completion').mode,
      parties: [{ role: 'worker', name: learnerName }],
      sender: null,
    })

    // The render can take a while (a cold Chromium start), and another preparation for this item
    // (a reload and Try again, or the daily job) may have made its document meanwhile. Use that
    // one: making ours now would withdraw it, and its link may already be on the learner's screen.
    stage = 'recheck'
    const madeMeanwhile = await reuseCertificate(admin, await rereadForCertificate(assignment.id), seriesKey, new Date())
    if (madeMeanwhile) return madeMeanwhile

    stage = 'create'
    const created = await createSigningRequest({
      kind: 'training_completion',
      subjectId: employee.employee_id,
      title,
      summary: `Confirm that you have read and understood ${course.title}. This is your certificate.`,
      pdf: prepared.pdf,
      render: prepared.render,
      parties: [
        {
          role: 'worker',
          name: learnerName,
          email: employee.email_address,
          employeeId: employee.employee_id,
          identityCheck: employee.date_of_birth ? 'date_of_birth' : 'none',
        },
      ],
      // The app makes this document by itself: nobody signs for the business, and the "Signed"
      // notice goes to the manager mailbox (the kind's notifySenderOnCompletion).
      createdBy: null,
      createdByName: SYSTEM_ACTOR.name,
      seriesKey,
      context: { training },
      sendLinkEmails: false,
    })
    const partyId = created.deliveries[0]?.partyId
    if (!partyId) throw new Error('The certificate was made with nobody to confirm it.')

    stage = 'link'
    const linked = await linkCertificate(assignment, created.documentId)

    // Ours is settled only if the item still points at it once linked: a preparation that
    // overlapped ours (two tabs, or the daily job) may have moved the item, or made a newer
    // document that withdrew ours. Otherwise read the item again and use whatever document now
    // stands for it, so no caller hands the learner a link to a withdrawn document.
    stage = 'settle'
    let settled: { documentId: string; partyId: string }
    if (linked && (await stillStandsFor(admin, assignment.id, created.documentId))) {
      settled = { documentId: created.documentId, partyId }
    } else {
      const other = await reuseCertificate(admin, await rereadForCertificate(assignment.id), seriesKey, new Date())
      if (!other) throw new TrainingError('conflict', 'This training item changed while the certificate was being made.')
      settled = other
    }

    // One log line per document made: a preparation that settles on another's document leaves
    // that line to the preparation that made it.
    if (settled.documentId === created.documentId) {
      await writeEventSafely(
        { ...event, eventType: 'confirmation_prepared', meta: { documentId: created.documentId, version: created.version } },
        'the certificate was prepared'
      )
    }
    return settled
  } catch (error) {
    const meta: TrainingEventMeta = { stage, code: errorCode(error) }
    await writeEventSafely({ ...event, eventType: 'confirmation_failed', meta }, 'the certificate could not be prepared')
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Practical sign-off
// ---------------------------------------------------------------------------------------------

async function previousExpiresOn(assignment: TrainingAssignment, refresherMonths: number | null): Promise<string | null> {
  const cycles = await TrainingService.listAssignmentsForEmployee(assignment.employeeId)
  return expiryToExtendFrom(
    cycles.filter((cycle) => cycle.courseId === assignment.courseId),
    assignment.cycle,
    refresherMonths
  )
}

/** The tasks chosen, in the course's own order, with their wording at the time. */
function chosenTasks(version: TrainingCourseVersion, keys: readonly string[]): SignoffTaskRecord[] {
  if (keys.length === 0) throw new TrainingError('invalid', 'Tick at least one task you watched.')
  if (new Set(keys).size !== keys.length) throw new TrainingError('invalid', 'A task is ticked twice.')
  const known = new Map(version.content.tasks.map((task) => [task.key, task.text]))
  const unknown = keys.filter((key) => !known.has(key))
  if (unknown.length > 0) throw new TrainingError('invalid', 'A task is not part of this course. Refresh and try again.')
  const chosen = new Set(keys)
  return version.content.tasks.filter((task) => chosen.has(task.key)).map((task) => ({ key: task.key, text: task.text }))
}

/**
 * Records a practical sign-off: the manager (`actor`) signs as the business now, and the learner
 * confirms in person through the existing in-person handover, whose URL is returned. Series key
 * `training-signoff:<slug>`. `tasks` are task keys from the course; `observedOn` a London date.
 * The assignment becomes `awaiting_confirmation` with `signoff_tasks`, `signed_off_*` and
 * `supervised_only` (under 18 on a `supervisedOnlyUnder18` course) set.
 *
 * Refused when the course limits under 18s to supervised work and the record has no date of
 * birth: whether "Supervised only" belongs on the sign-off cannot be known. Refused too for a
 * course with a minimum age (16 or 18) when the learner is under it today or was on `observedOn`,
 * or has no date of birth (`signoffMinimumAgeRefusal`).
 *
 * Writes no training event: the caller (recordPracticalSignoff) writes the one
 * `signoff_recorded` line, with the manager's note and the `supervisedOnly` returned here.
 * Either everything is recorded or nothing is: a failure after the document is made withdraws it
 * and leaves the item as it was, so the manager can simply try again.
 */
export async function createPracticalSignoff(input: {
  assignmentId: string
  tasks: string[]
  observedOn: string
  actor: StaffActor
}): Promise<{ documentId: string; partyId: string; inPersonUrl: string; supervisedOnly: boolean }> {
  const assignment = await TrainingService.getAssignment(input.assignmentId)
  if (!assignment) throw new TrainingError('not_found', 'That training item could not be found.')
  const course = await loadCourse(assignment)
  if (course.kind !== 'practical') throw new TrainingError('invalid', 'Only a practical course is signed off in person.')
  if (assignment.status === 'waiting') throw new TrainingError('not_ready', 'They need to finish the course before this one first.')
  if (!SIGNOFF_FROM.includes(assignment.status)) {
    throw new TrainingError('not_allowed', 'This training item is closed, so it cannot be signed off.')
  }
  if (typeof input.observedOn !== 'string' || !isValidIsoDate(input.observedOn)) {
    throw new TrainingError('invalid', 'Choose the date you watched them.')
  }
  if (input.observedOn > trainingToday()) throw new TrainingError('invalid', 'The date you watched them cannot be in the future.')

  const version = assignment.versionId
    ? await TrainingService.getPublishedVersion(assignment.versionId)
    : await TrainingService.getCurrentVersion(course.id)
  if (!version) throw new TrainingError('not_ready', 'This course has no published version yet.')
  const tasks = chosenTasks(version, input.tasks)

  const admin = createAdminClient()
  const employee = await loadEmployee(admin, assignment.employeeId)
  const learnerName = learnerNameOf(employee)
  // The minimum age is checked on the day they were watched as well as today, for every caller.
  const tooYoung = signoffMinimumAgeRefusal(
    course,
    { dateOfBirth: employee.date_of_birth, name: learnerName },
    input.observedOn,
    trainingToday()
  )
  if (tooYoung) throw new TrainingError(tooYoung.reason === 'dob_missing' ? 'not_ready' : 'not_allowed', tooYoung.message)
  let supervisedOnly = false
  if (course.supervisedOnlyUnder18) {
    const age = ageOn(employee.date_of_birth, input.observedOn)
    if (age === null) {
      throw new TrainingError(
        'not_ready',
        'Add their date of birth to the employee record first, so the sign-off shows whether they must be supervised.'
      )
    }
    supervisedOnly = age < 18
  }

  const expiresOn = computeExpiresOn(course.refresherMonths, input.observedOn, await previousExpiresOn(assignment, course.refresherMonths))
  const windowOpensOn = computeWindowOpensOn(expiresOn, course.windowDays)
  const certificateNumber = assignment.certificateNumber ?? generateCertificateNumber()
  const versionLabel = versionLabelOf(version)
  const title = trainingSignoffTitle(course.title)
  const training: TrainingSigningContext = {
    assignment_id: assignment.id,
    course_id: course.id,
    course_slug: course.slug,
    course_title: course.title,
    version_label: versionLabel,
    certificate_number: certificateNumber,
    cycle: assignment.cycle,
    learner_name: learnerName,
    manager_name: input.actor.name,
    observed_on: input.observedOn,
  }

  const source = buildTrainingSignoffSource({
    holderName: learnerName,
    courseTitle: course.title,
    versionLabel,
    managerName: input.actor.name,
    observedOn: input.observedOn,
    tasks,
    supervisedOnly,
    expiresOn,
    certificateNumber,
  })
  const prepared = await prepareSigningDocument({
    source,
    mode: getSigningKind('training_signoff').mode,
    parties: [{ role: 'worker', name: learnerName }],
    sender: { name: input.actor.name },
  })

  // The manager signs for the business here, as the document is made.
  const created = await createSigningRequest({
    kind: 'training_signoff',
    subjectId: employee.employee_id,
    title,
    summary: `${input.actor.name} watched you do the tasks for ${course.title}. Check the list, then sign.`,
    pdf: prepared.pdf,
    render: prepared.render,
    parties: [
      {
        role: 'worker',
        name: learnerName,
        // No link is made for an in-person kind; the address is kept so the signed copy reaches them.
        email: employee.email_address,
        employeeId: employee.employee_id,
        identityCheck: 'none',
      },
    ],
    createdBy: input.actor.id,
    createdByName: input.actor.name,
    seriesKey: trainingSignoffSeriesKey(course.slug),
    context: { training },
    sendLinkEmails: false,
  })
  const partyId = created.deliveries[0]?.partyId
  if (!partyId) throw new Error('The sign-off was made with nobody to sign it.')

  // Withdraws the new document when the sign-off cannot be finished, rather than leave a
  // signature to be collected for an item that never points at it.
  const withdraw = async (): Promise<void> => {
    try {
      await voidSigningDocument({ documentId: created.documentId, userId: input.actor.id, reason: 'The sign-off could not be recorded' })
    } catch (voidError) {
      logger.error('Training signing: a sign-off document could not be withdrawn after the sign-off failed', {
        error: asError(voidError),
        metadata: { assignmentId: assignment.id, documentId: created.documentId },
      })
    }
  }

  // The handover link comes before the item moves on: if it cannot be made, nothing is recorded
  // and the manager is not told "nothing has been signed" about an item already waiting.
  let inPersonUrl: string
  try {
    inPersonUrl = (await startInPersonSigning({ partyId, userId: input.actor.id })).url
  } catch (error) {
    await withdraw()
    throw error
  }

  try {
    await TrainingService.updateAssignment(
      assignment.id,
      {
        status: 'awaiting_confirmation',
        signingDocumentId: created.documentId,
        versionId: assignment.versionId ?? version.id,
        signoffTasks: tasks,
        signedOffBy: input.actor.id,
        signedOffByName: input.actor.name,
        signedOffOn: input.observedOn,
        supervisedOnly,
        expiresOn,
        windowOpensOn,
        certificateNumber,
        declinedAt: null,
      },
      { expectedStatuses: [assignment.status], expectedUpdatedAt: assignment.updatedAt }
    )
  } catch (error) {
    // The item could not be pointed at the document, so nothing would ever complete it.
    await withdraw()
    throw error
  }

  return { documentId: created.documentId, partyId, inPersonUrl, supervisedOnly }
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

/**
 * The item a training document belongs to: the one pointing at it, or, when an item lost its
 * link (a write that failed after the document was made), the item named in the document's
 * context, provided it points at no other document.
 */
async function findAssignmentForDocument(document: DocumentForTraining): Promise<TrainingAssignment | null> {
  const linked = await TrainingService.findAssignmentBySigningDocument(document.id)
  if (linked) return linked
  const training = readTrainingSigningContext(document.context)
  if (!training) return null
  const named = await TrainingService.getAssignment(training.assignment_id)
  if (!named || named.signingDocumentId !== null) return null
  return named
}

/** Moves the item to completed from a confirmed document. Safe to run twice. */
async function completeFromDocument(assignment: TrainingAssignment, document: DocumentForTraining): Promise<void> {
  if (assignment.status === 'completed') return
  if (!PREPARE_FROM.includes(assignment.status)) {
    // Waived or cancelled while the document was out: the closure check normally withdraws it
    // first. Nothing to complete; say so rather than reopen a closed item.
    logger.error('Training signing: a training document was confirmed for an item that is closed', {
      metadata: { assignmentId: assignment.id, documentId: document.id, status: assignment.status },
    })
    return
  }
  const confirmedAt = document.completed_at ?? new Date().toISOString()
  const course = await loadCourse(assignment)
  const completedOn = course.kind === 'practical' ? (assignment.signedOffOn ?? londonDateOf(confirmedAt)) : assignment.completedOn
  try {
    await TrainingService.updateAssignment(
      assignment.id,
      {
        status: 'completed',
        confirmedAt,
        completedOn,
        signingDocumentId: document.id,
        declinedAt: null,
      },
      { expectedStatuses: PREPARE_FROM, expectedUpdatedAt: assignment.updatedAt }
    )
  } catch (error) {
    if (error instanceof TrainingError && error.code === 'conflict') {
      const current = await TrainingService.getAssignment(assignment.id)
      if (current?.status === 'completed') return
    }
    throw error
  }
  await writeEventSafely(
    {
      employeeId: assignment.employeeId,
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      actor: SYSTEM_ACTOR,
      eventType: 'completed',
      meta: { documentId: document.id, kind: document.kind, completedOn: completedOn ?? null },
    },
    'the training was completed'
  )
}

/**
 * Completion hook for both training kinds: the assignment holding `signing_document_id` becomes
 * `completed` with `confirmed_at` (a practical one takes `completed_on = signed_off_on`), and a
 * `completed` event is written. Idempotent on the document id; a document no assignment points
 * at (and whose named item already points at another document) does nothing.
 */
export async function onTrainingSigningCompleted(documentId: string): Promise<void> {
  const admin = createAdminClient()
  const document = await loadDocument(admin, documentId)
  if (!document || !DONE_STATUSES.includes(document.status)) return
  if (document.kind !== 'training_completion' && document.kind !== 'training_signoff') return
  const assignment = await findAssignmentForDocument(document)
  if (!assignment) return
  await completeFromDocument(assignment, document)
}

/**
 * Decline hook: the assignment becomes `declined` with `declined_at`, chasing stops, a `declined`
 * event is written and the manager is told in the next daily email. Idempotent on the document id.
 */
export async function onTrainingSigningDeclined(documentId: string): Promise<void> {
  const admin = createAdminClient()
  const document = await loadDocument(admin, documentId)
  if (!document || document.status !== 'declined') return
  if (document.kind !== 'training_completion' && document.kind !== 'training_signoff') return
  const assignment = await TrainingService.findAssignmentBySigningDocument(document.id)
  if (!assignment || assignment.status !== 'awaiting_confirmation') return

  const party = await loadWorkerParty(admin, document.id)
  const declinedAt = party?.declined_at ?? new Date().toISOString()
  try {
    await TrainingService.updateAssignment(
      assignment.id,
      { status: 'declined', declinedAt },
      { expectedStatuses: ['awaiting_confirmation'], expectedUpdatedAt: assignment.updatedAt }
    )
  } catch (error) {
    if (error instanceof TrainingError && error.code === 'conflict') {
      const current = await TrainingService.getAssignment(assignment.id)
      if (current && current.status !== 'awaiting_confirmation') return
    }
    throw error
  }
  await writeEventSafely(
    {
      employeeId: assignment.employeeId,
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      actor: SYSTEM_ACTOR,
      eventType: 'declined',
      meta: { documentId: document.id, kind: document.kind },
    },
    'the training was declined'
  )
}
