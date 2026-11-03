import { z } from 'zod'
import { CourseContentSchema } from './course-schema'
import {
  TRAINING_ASSIGNMENT_REASONS,
  TRAINING_ASSIGNMENT_STATUSES,
  TRAINING_AUDIENCE_AGES,
  TRAINING_CANCEL_REASONS,
  TRAINING_COURSE_KINDS,
  TRAINING_COURSE_STATUSES,
  TRAINING_EVENT_TYPES,
  TRAINING_GROUPS,
  TRAINING_PAUSE_REASONS,
  TRAINING_REMINDER_KINDS,
  TRAINING_REMINDER_STATUSES,
  TRAINING_VERSION_STATES,
  TrainingDataError,
  type AssignmentProgress,
  type AttemptAnswers,
  type AttemptResult,
  type CourseContent,
  type ServedQuestion,
  type SignoffTaskRecord,
  type TrainingAssignment,
  type TrainingAssignmentPatch,
  type TrainingAssignmentRow,
  type TrainingAttempt,
  type TrainingAttemptRow,
  type TrainingCourse,
  type TrainingCourseRow,
  type TrainingCourseVersion,
  type TrainingCourseVersionMeta,
  type TrainingCourseVersionRow,
  type TrainingEvent,
  type TrainingEventMeta,
  type TrainingEventRow,
  type TrainingProfile,
  type TrainingProfileRow,
  type TrainingReminder,
  type TrainingReminderRow,
  type VersionImage,
} from './types'

/**
 * Row to record mappers for the seven training tables: snake_case as stored to the camelCase
 * types in types.ts, by hand as the rest of the app does (there is no fromDb helper).
 *
 * Pure. Checked text columns are narrowed to their fixed lists and JSON columns are parsed to
 * their shapes; anything that does not match throws a TrainingDataError naming the table and
 * column, because a training record that reads wrongly must never be shown as if it were right.
 */

function fail(table: string, column: string, detail: string): never {
  throw new TrainingDataError(`${table}.${column}: ${detail}`)
}

function oneOf<const T extends readonly string[]>(values: T, value: string, table: string, column: string): T[number] {
  if ((values as readonly string[]).includes(value)) return value as T[number]
  return fail(table, column, `unexpected value "${value}"`)
}

function oneOfOrNull<const T extends readonly string[]>(
  values: T,
  value: string | null,
  table: string,
  column: string
): T[number] | null {
  return value === null ? null : oneOf(values, value, table, column)
}

function listOf<const T extends readonly string[]>(values: T, list: string[], table: string, column: string): T[number][] {
  return list.map((value) => oneOf(values, value, table, column))
}

function parseJson<S extends z.ZodTypeAny>(schema: S, value: unknown, table: string, column: string): z.infer<S> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
  return fail(table, column, `does not match its shape${where} (${issue?.message ?? 'invalid'})`)
}

const isoText = z.string().min(1)

const SectionProgressSchema = z.object({
  card: z.number().int().min(0).default(0),
  fails: z.number().int().min(0).default(0),
  passedAt: isoText.nullable().default(null),
  lastAttemptQuestionIds: z.array(z.string()).default([]),
})

const ProgressSchema = z.object({
  sections: z.record(SectionProgressSchema).default({}),
  current: z.string().nullable().default(null),
  introSeen: z.boolean().default(false),
})

const ServedSchema = z.array(
  z
    .object({ questionId: z.string().min(1), optionOrder: z.array(z.number().int().min(0)).min(1) })
    .refine(
      (item) => [...item.optionOrder].sort((a, b) => a - b).every((value, index) => value === index),
      'optionOrder must hold each option index exactly once'
    )
)

const AnswersSchema = z.record(z.number().int().min(0))

const ResultsSchema = z.array(
  z.object({ questionId: z.string().min(1), chosen: z.number().int().min(0), correct: z.boolean(), critical: z.boolean() })
)

const ImagesSchema = z.array(
  z.object({
    src: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    contentType: z.string().min(1),
    bytes: z.number().int().min(0),
  })
)

const SignoffTasksSchema = z.array(z.object({ key: z.string().min(1), text: z.string() }))

const MetaValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.number())])
const MetaSchema = z.record(MetaValueSchema)
const DetailSchema = z.record(z.unknown())

/** An empty progress record, as a new cycle starts. */
export function emptyProgress(): AssignmentProgress {
  return { sections: {}, current: null, introSeen: false }
}

/** `training_assignments.progress`. Missing fields take their starting values; wrong types throw. */
export function parseProgress(value: unknown): AssignmentProgress {
  if (value === null || value === undefined) return emptyProgress()
  return parseJson(ProgressSchema, value, 'training_assignments', 'progress')
}

/** `training_attempts.served`. */
export function parseServed(value: unknown): ServedQuestion[] {
  return parseJson(ServedSchema, value, 'training_attempts', 'served')
}

/** `training_attempts.answers` (null until submitted). */
function parseAnswers(value: unknown): AttemptAnswers | null {
  if (value === null || value === undefined) return null
  return parseJson(AnswersSchema, value, 'training_attempts', 'answers')
}

/** `training_attempts.results` (null until submitted). */
function parseResults(value: unknown): AttemptResult[] | null {
  if (value === null || value === undefined) return null
  return parseJson(ResultsSchema, value, 'training_attempts', 'results')
}

/** `training_course_versions.images`. */
function parseImages(value: unknown): VersionImage[] {
  if (value === null || value === undefined) return []
  return parseJson(ImagesSchema, value, 'training_course_versions', 'images')
}

/** `training_course_versions.content`: the frozen course, re-read through the course schema. */
function parseCourseContent(value: unknown): CourseContent {
  return parseJson(CourseContentSchema, value, 'training_course_versions', 'content')
}

/** `training_assignments.signoff_tasks` (null until a sign-off is recorded). */
function parseSignoffTasks(value: unknown): SignoffTaskRecord[] | null {
  if (value === null || value === undefined) return null
  return parseJson(SignoffTasksSchema, value, 'training_assignments', 'signoff_tasks')
}

/** `training_events.meta`. */
function parseEventMeta(value: unknown): TrainingEventMeta {
  if (value === null || value === undefined) return {}
  return parseJson(MetaSchema, value, 'training_events', 'meta')
}

export function mapCourseRow(row: TrainingCourseRow): TrainingCourse {
  const table = 'training_courses'
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: oneOf(TRAINING_COURSE_KINDS, row.kind, table, 'kind'),
    audienceGroups: listOf(TRAINING_GROUPS, row.audience_groups ?? [], table, 'audience_groups'),
    audienceAge: oneOf(TRAINING_AUDIENCE_AGES, row.audience_age, table, 'audience_age'),
    isEssentials: row.is_essentials,
    prerequisiteCourseId: row.prerequisite_course_id,
    newStarterDueDays: row.new_starter_due_days,
    existingStaffDueDays: row.existing_staff_due_days,
    refresherMonths: row.refresher_months,
    windowDays: row.window_days,
    supervisedOnlyUnder18: row.supervised_only_under_18,
    displayOrder: row.display_order,
    status: oneOf(TRAINING_COURSE_STATUSES, row.status, table, 'status'),
    currentVersionId: row.current_version_id,
    summary: row.summary,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** A version without reading its content, for lists that select every column but `content`. */
export function mapCourseVersionMetaRow(row: Omit<TrainingCourseVersionRow, 'content'>): TrainingCourseVersionMeta {
  const table = 'training_course_versions'
  const state = oneOf(TRAINING_VERSION_STATES, row.state, table, 'state')
  if (state === 'published' && (row.major === null || row.minor === null || row.published_at === null)) {
    fail(table, 'state', 'a published version has no number or publish time')
  }
  return {
    id: row.id,
    courseId: row.course_id,
    state,
    major: row.major,
    minor: row.minor,
    contentSha256: row.content_sha256,
    images: parseImages(row.images),
    changeNote: row.change_note,
    redoRequired: row.redo_required,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
    publishedBy: row.published_by,
    publishedByName: row.published_by_name,
    publishedAt: row.published_at,
  }
}

export function mapCourseVersionRow(row: TrainingCourseVersionRow): TrainingCourseVersion {
  const { content, ...rest } = row
  return { ...mapCourseVersionMetaRow(rest), content: parseCourseContent(content) }
}

export function mapProfileRow(row: TrainingProfileRow): TrainingProfile {
  const table = 'training_profiles'
  return {
    employeeId: row.employee_id,
    groups: listOf(TRAINING_GROUPS, row.groups ?? [], table, 'groups'),
    groupsConfirmedAt: row.groups_confirmed_at,
    groupsConfirmedBy: row.groups_confirmed_by,
    groupsConfirmedByName: row.groups_confirmed_by_name,
    pausedFrom: row.paused_from,
    pausedUntil: row.paused_until,
    pauseReason: oneOfOrNull(TRAINING_PAUSE_REASONS, row.pause_reason, table, 'pause_reason'),
    adjustmentNote: row.adjustment_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapAssignmentRow(row: TrainingAssignmentRow): TrainingAssignment {
  const table = 'training_assignments'
  return {
    id: row.id,
    employeeId: row.employee_id,
    courseId: row.course_id,
    cycle: row.cycle,
    reason: oneOf(TRAINING_ASSIGNMENT_REASONS, row.reason, table, 'reason'),
    status: oneOf(TRAINING_ASSIGNMENT_STATUSES, row.status, table, 'status'),
    assignedOn: row.assigned_on,
    dueOn: row.due_on,
    windowOpensOn: row.window_opens_on,
    versionId: row.version_id,
    progress: parseProgress(row.progress),
    startedAt: row.started_at,
    lastSectionPassedAt: row.last_section_passed_at,
    completedOn: row.completed_on,
    expiresOn: row.expires_on,
    certificateNumber: row.certificate_number,
    signingDocumentId: row.signing_document_id,
    confirmedAt: row.confirmed_at,
    lockedAt: row.locked_at,
    lockedSection: row.locked_section,
    declinedAt: row.declined_at,
    waivedAt: row.waived_at,
    waivedBy: row.waived_by,
    waivedByName: row.waived_by_name,
    waiveReason: row.waive_reason,
    cancelledAt: row.cancelled_at,
    cancelReason: oneOfOrNull(TRAINING_CANCEL_REASONS, row.cancel_reason, table, 'cancel_reason'),
    externalIssuer: row.external_issuer,
    externalReference: row.external_reference,
    externalIssuedOn: row.external_issued_on,
    externalFilePath: row.external_file_path,
    signoffTasks: parseSignoffTasks(row.signoff_tasks),
    signedOffBy: row.signed_off_by,
    signedOffByName: row.signed_off_by_name,
    signedOffOn: row.signed_off_on,
    supervisedOnly: row.supervised_only,
    dueChangeReason: row.due_change_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ASSIGNMENT_COLUMNS: Record<keyof TrainingAssignmentPatch, keyof TrainingAssignmentRow> = {
  reason: 'reason',
  status: 'status',
  assignedOn: 'assigned_on',
  dueOn: 'due_on',
  windowOpensOn: 'window_opens_on',
  versionId: 'version_id',
  progress: 'progress',
  startedAt: 'started_at',
  lastSectionPassedAt: 'last_section_passed_at',
  completedOn: 'completed_on',
  expiresOn: 'expires_on',
  certificateNumber: 'certificate_number',
  signingDocumentId: 'signing_document_id',
  confirmedAt: 'confirmed_at',
  lockedAt: 'locked_at',
  lockedSection: 'locked_section',
  declinedAt: 'declined_at',
  waivedAt: 'waived_at',
  waivedBy: 'waived_by',
  waivedByName: 'waived_by_name',
  waiveReason: 'waive_reason',
  cancelledAt: 'cancelled_at',
  cancelReason: 'cancel_reason',
  externalIssuer: 'external_issuer',
  externalReference: 'external_reference',
  externalIssuedOn: 'external_issued_on',
  externalFilePath: 'external_file_path',
  signoffTasks: 'signoff_tasks',
  signedOffBy: 'signed_off_by',
  signedOffByName: 'signed_off_by_name',
  signedOffOn: 'signed_off_on',
  supervisedOnly: 'supervised_only',
  dueChangeReason: 'due_change_reason',
}

/**
 * A camelCase assignment change as the snake_case columns to write. Only the fields present are
 * returned, so an update never blanks a column it did not mean to touch.
 */
export function assignmentPatchToRow(patch: TrainingAssignmentPatch): Partial<TrainingAssignmentRow> {
  const row: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const column = ASSIGNMENT_COLUMNS[field as keyof TrainingAssignmentPatch]
    if (!column) throw new TrainingDataError(`training_assignments: no column for "${field}"`)
    row[column] = value
  }
  return row as Partial<TrainingAssignmentRow>
}

export function mapAttemptRow(row: TrainingAttemptRow): TrainingAttempt {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    employeeId: row.employee_id,
    versionId: row.version_id,
    sectionKey: row.section_key,
    attemptNo: row.attempt_no,
    served: parseServed(row.served),
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    answers: parseAnswers(row.answers),
    results: parseResults(row.results),
    wrongCount: row.wrong_count,
    criticalMissed: row.critical_missed,
    passed: row.passed,
  }
}

export function mapEventRow(row: TrainingEventRow): TrainingEvent {
  return {
    id: row.id,
    employeeId: row.employee_id,
    assignmentId: row.assignment_id,
    courseId: row.course_id,
    eventType: oneOf(TRAINING_EVENT_TYPES, row.event_type, 'training_events', 'event_type'),
    actorId: row.actor_id,
    actorName: row.actor_name,
    noteCode: row.note_code,
    note: row.note,
    meta: parseEventMeta(row.meta),
    createdAt: row.created_at,
  }
}

export function mapReminderRow(row: TrainingReminderRow): TrainingReminder {
  const table = 'training_reminders'
  return {
    id: row.id,
    kind: oneOf(TRAINING_REMINDER_KINDS, row.kind, table, 'kind'),
    claimKey: row.claim_key,
    assignmentId: row.assignment_id,
    employeeId: row.employee_id,
    londonDate: row.london_date,
    status: oneOf(TRAINING_REMINDER_STATUSES, row.status, table, 'status'),
    detail: row.detail === null || row.detail === undefined ? {} : parseJson(DetailSchema, row.detail, table, 'detail'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
