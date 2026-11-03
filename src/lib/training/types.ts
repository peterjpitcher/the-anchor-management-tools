import type { z } from 'zod'
import type { SigningDocumentStatus } from '@/lib/signing/types'
import type {
  CourseCardSchema,
  CourseContentSchema,
  CourseObjectiveSchema,
  CourseQuestionSchema,
  CourseSectionSchema,
  PracticalTaskSchema,
} from './course-schema'

/**
 * Every type the staff training feature shares: the course file format, the database rows (as
 * stored, snake_case) and their camelCase forms, the fixed lists, and the view models the server
 * actions return. Build contract: tasks/plan-2026-11-02-staff-training-build.md.
 *
 * This file holds types and constant lists only (plus two small error classes), so client
 * components, server code and tests can all import it. Rules live in the other files of
 * src/lib/training/; reads and writes in src/services/training.ts.
 */

// ---------------------------------------------------------------------------------------------
// Fixed lists (each mirrors a CHECK constraint in 20261103090000_training_tables.sql)
// ---------------------------------------------------------------------------------------------

/** Training groups. A course for `[]` groups is for everyone. */
export const TRAINING_GROUPS = ['bar', 'kitchen', 'floor', 'management'] as const
export type TrainingGroup = (typeof TRAINING_GROUPS)[number]

/** Course kinds in the database. External qualifications are created on the Courses page. */
export const TRAINING_COURSE_KINDS = ['online', 'practical', 'external'] as const
export type TrainingCourseKind = (typeof TRAINING_COURSE_KINDS)[number]

/** Course kinds a `course.json` may declare. */
export const COURSE_FILE_KINDS = ['online', 'practical'] as const
type CourseFileKind = (typeof COURSE_FILE_KINDS)[number]

/** Age rule: everyone, under-18s only, or 18 and over only (from date of birth). */
export const TRAINING_AUDIENCE_AGES = ['all', 'under_18', 'adult'] as const
export type TrainingAudienceAge = (typeof TRAINING_AUDIENCE_AGES)[number]

export const TRAINING_COURSE_STATUSES = ['draft', 'live', 'retired'] as const
export type TrainingCourseStatus = (typeof TRAINING_COURSE_STATUSES)[number]

export const TRAINING_VERSION_STATES = ['draft', 'published'] as const
export type TrainingVersionState = (typeof TRAINING_VERSION_STATES)[number]

/** Every status a cycle can hold. */
export const TRAINING_ASSIGNMENT_STATUSES = [
  'waiting',
  'assigned',
  'in_progress',
  'locked',
  'awaiting_confirmation',
  'declined',
  'completed',
  'waived',
  'cancelled',
] as const
export type TrainingAssignmentStatus = (typeof TRAINING_ASSIGNMENT_STATUSES)[number]

/** Open cycles: at most one per person and course (unique index `training_assignments_one_open`). */
export const OPEN_ASSIGNMENT_STATUSES = [
  'waiting',
  'assigned',
  'in_progress',
  'locked',
  'awaiting_confirmation',
  'declined',
] as const satisfies readonly TrainingAssignmentStatus[]
export type OpenAssignmentStatus = (typeof OPEN_ASSIGNMENT_STATUSES)[number]

/** Why a cycle exists. */
export const TRAINING_ASSIGNMENT_REASONS = [
  'new_starter',
  'existing_staff',
  'course_added',
  'refresher',
  'redo',
  'manual',
  'renewal',
] as const
export type TrainingAssignmentReason = (typeof TRAINING_ASSIGNMENT_REASONS)[number]

/** Why an open cycle was cancelled. */
export const TRAINING_CANCEL_REASONS = ['left', 'group_removed', 'course_retired', 'replaced', 'manual'] as const
export type TrainingCancelReason = (typeof TRAINING_CANCEL_REASONS)[number]

/** Pause reasons: a fixed list, never a health detail. */
export const TRAINING_PAUSE_REASONS = ['leave_of_absence', 'parental_leave', 'other'] as const
export type PauseReason = (typeof TRAINING_PAUSE_REASONS)[number]

/** `training_events.event_type`. */
export const TRAINING_EVENT_TYPES = [
  'course_draft_uploaded',
  'course_published',
  'course_retired',
  'assigned',
  'started',
  'section_passed',
  'section_failed',
  'locked',
  'unlocked',
  'extended',
  'waived',
  'paused',
  'resumed',
  'cancelled',
  'declined',
  'confirmation_prepared',
  'confirmation_failed',
  'completed',
  'reminder_sent',
  'escalated',
  'external_recorded',
  'signoff_recorded',
  'groups_changed',
  'redo_requested',
] as const
export type TrainingEventType = (typeof TRAINING_EVENT_TYPES)[number]

/** `training_reminders.kind`: one ledger row per claim (contract 2.1 and spec 8.4). */
export const TRAINING_REMINDER_KINDS = ['staff_step', 'daily_cap', 'manager_daily', 'escalation', 'no_login', 'undeliverable'] as const
export type TrainingReminderKind = (typeof TRAINING_REMINDER_KINDS)[number]

export const TRAINING_REMINDER_STATUSES = ['claimed', 'sent', 'uncertain'] as const
export type TrainingReminderStatus = (typeof TRAINING_REMINDER_STATUSES)[number]

/**
 * What one person's item shows, from `displayStateFor` (states.ts). Listed in the order the
 * contract checks them: the first that matches wins. One exception (spec 4.3, validity is decided
 * by expiry alone): while a cycle is open and the latest completion has expired, `expired` is
 * checked straight after `awaiting_confirmation`, so it replaces waiting, overdue, due soon, in
 * progress and not started. Another (spec 4.1, a practical counts as done only while its
 * prerequisite is valid): a completion still in date whose prerequisite is no longer met shows
 * `waiting` instead of `refresher_due` or `done`.
 */
export const TRAINING_DISPLAY_STATES = [
  'not_required',
  'paused',
  'locked',
  'declined',
  'awaiting_confirmation',
  'waiting',
  'overdue',
  'due_soon',
  'in_progress',
  'not_started',
  'waived',
  'expired',
  'refresher_due',
  'done',
] as const
export type TrainingDisplayState = (typeof TRAINING_DISPLAY_STATES)[number]

/** The steps of the staff chasing ladder (spec 8.1). */
export const STAFF_REMINDER_STEPS = ['assigned', 'nudge', 'due_soon', 'overdue', 'weekly'] as const
export type StaffReminderStep = (typeof STAFF_REMINDER_STEPS)[number]

/** What puts an item in the manager's daily email (spec 8.3). */
export const MANAGER_TRIGGERS = [
  'essentials_overdue',
  'overdue_7_days',
  'locked',
  'declined',
  'no_login',
  'undeliverable',
  'certificate_failed',
] as const
export type ManagerTrigger = (typeof MANAGER_TRIGGERS)[number]

/** Flags shown beside a person on the matrix and their record. */
export const TRAINING_PERSON_FLAGS = ['groups_not_confirmed', 'no_login', 'dob_missing'] as const
export type TrainingPersonFlag = (typeof TRAINING_PERSON_FLAGS)[number]

/** The values a callout card's `tone` may take in a course file (course content, not a status map). */
export const CALLOUT_TONE_VALUES = ['info', 'warning', 'manager'] as const
export type CalloutTone = (typeof CALLOUT_TONE_VALUES)[number]

/** How a republish is marked (contract 5.3). */
export const PUBLISH_CHANGES = ['first', 'minor', 'redo'] as const
export type PublishChange = (typeof PUBLISH_CHANGES)[number]

/** Employee statuses as stored on `employees.status`. */
export type TrainingEmployeeStatus = 'Onboarding' | 'Active' | 'Started Separation' | 'Former'

/** Statuses training applies to. Started Separation keeps open cycles only, never a new one. */
export const TRAINING_IN_SCOPE_STATUSES = ['Active', 'Started Separation'] as const satisfies readonly TrainingEmployeeStatus[]

/**
 * The progress key `saveTrainingProgress` takes to record the intro cards as seen. Section keys
 * match `^[a-z0-9-]{2,60}$`, so a leading underscore can never clash with one.
 */
export const TRAINING_INTRO_KEY = '_intro'

/** What the player does after a check (contract 5.4). */
export type CheckNext = 'next_section' | 'retry' | 'locked' | 'confirm' | 'confirm_retry'

// ---------------------------------------------------------------------------------------------
// Course content (`course.json`), inferred from the Zod schema in course-schema.ts
// ---------------------------------------------------------------------------------------------

/** A validated course file with every default filled in. Stored frozen in `training_course_versions.content`. */
export type CourseContent = z.infer<typeof CourseContentSchema>
/** A course file as written, before defaults. */
export type CourseContentInput = z.input<typeof CourseContentSchema>
export type CourseSection = z.infer<typeof CourseSectionSchema>
export type CourseCard = z.infer<typeof CourseCardSchema>
type CourseObjective = z.infer<typeof CourseObjectiveSchema>
export type CourseQuestion = z.infer<typeof CourseQuestionSchema>
export type PracticalTask = z.infer<typeof PracticalTaskSchema>
export type DoDontCard = Extract<CourseCard, { type: 'do_dont' }>
export type CalloutCard = Extract<CourseCard, { type: 'callout' }>
export type TableCard = Extract<CourseCard, { type: 'table' }>
export type StepsCard = Extract<CourseCard, { type: 'steps' }>
export type ImageCard = Extract<CourseCard, { type: 'image' }>
export type CheckYourselfCard = Extract<CourseCard, { type: 'check_yourself' }>

export type CourseValidationMode = 'draft' | 'publish'

/** What `validateCourse` returns. `course` is present only when `ok`. */
export interface CourseValidationResult {
  ok: boolean
  course?: CourseContent
  errors: string[]
  warnings: string[]
  /** `[[TO CONFIRM: ...]]` gaps with where they are. Draft mode only; in publish mode they are errors. */
  gaps: string[]
}

// ---------------------------------------------------------------------------------------------
// JSON column shapes
// ---------------------------------------------------------------------------------------------

/** One section's place in `training_assignments.progress.sections`. */
export interface SectionProgress {
  /** Index of the card the learner last reached (0 after a failed check). */
  card: number
  /** Failed checks since the section was last unlocked. Three locks the assignment. */
  fails: number
  /** When the section's check was passed (ISO instant), or null. */
  passedAt: string | null
  /** Questions served in the last attempt, so the next draw can avoid them. */
  lastAttemptQuestionIds: string[]
}

/** `training_assignments.progress`. Sections are taken in order. */
export interface AssignmentProgress {
  sections: Record<string, SectionProgress>
  /** Key of the section the learner is on, or null before they start. */
  current: string | null
  introSeen: boolean
}

/** A question as served in an attempt. `optionOrder[displayedIndex]` is the option's index in the course file. */
export interface ServedQuestion {
  questionId: string
  optionOrder: number[]
}

/** `training_attempts.answers`: question id to the ORIGINAL option index chosen. */
export type AttemptAnswers = Record<string, number>

/** One line of `training_attempts.results`. `chosen` is the original option index. */
export interface AttemptResult {
  questionId: string
  chosen: number
  correct: boolean
  critical: boolean
}

/** One image frozen with a version (`training_course_versions.images`). */
export interface VersionImage {
  /** The path the course file uses, e.g. `images/cover.jpg`. */
  src: string
  /** The bucket path, `courses/<courseId>/<sha256>.<ext>`. */
  path: string
  sha256: string
  contentType: string
  bytes: number
}

/** A practical task as recorded at sign-off (`training_assignments.signoff_tasks`), with its wording at the time. */
export interface SignoffTaskRecord {
  key: string
  text: string
}

/** `training_events.meta`: ids, counts, dates and short codes only, never contact details. */
export type TrainingEventMeta = Record<string, string | number | boolean | null | string[] | number[]>

// ---------------------------------------------------------------------------------------------
// Database rows as stored (snake_case). Field for field with the contract's tables, typed loosely
// enough (string for checked text, unknown for jsonb) that a row from the generated Supabase
// types can be passed straight to the mappers in mappers.ts.
// ---------------------------------------------------------------------------------------------

export interface TrainingCourseRow {
  id: string
  slug: string
  title: string
  kind: string
  audience_groups: string[]
  audience_age: string
  is_essentials: boolean
  prerequisite_course_id: string | null
  new_starter_due_days: number | null
  existing_staff_due_days: number | null
  refresher_months: number | null
  window_days: number
  supervised_only_under_18: boolean
  display_order: number
  status: string
  current_version_id: string | null
  summary: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export interface TrainingCourseVersionRow {
  id: string
  course_id: string
  state: string
  major: number | null
  minor: number | null
  content: unknown
  content_sha256: string
  images: unknown
  change_note: string | null
  redo_required: boolean
  uploaded_by: string | null
  uploaded_by_name: string | null
  uploaded_at: string
  published_by: string | null
  published_by_name: string | null
  published_at: string | null
}

export interface TrainingProfileRow {
  employee_id: string
  groups: string[]
  groups_confirmed_at: string | null
  groups_confirmed_by: string | null
  groups_confirmed_by_name: string | null
  paused_from: string | null
  paused_until: string | null
  pause_reason: string | null
  adjustment_note: string | null
  created_at: string
  updated_at: string
}

export interface TrainingAssignmentRow {
  id: string
  employee_id: string
  course_id: string
  cycle: number
  reason: string
  status: string
  assigned_on: string
  due_on: string | null
  window_opens_on: string | null
  version_id: string | null
  progress: unknown
  started_at: string | null
  last_section_passed_at: string | null
  completed_on: string | null
  expires_on: string | null
  certificate_number: string | null
  signing_document_id: string | null
  confirmed_at: string | null
  locked_at: string | null
  locked_section: string | null
  declined_at: string | null
  waived_at: string | null
  waived_by: string | null
  waived_by_name: string | null
  waive_reason: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  external_issuer: string | null
  external_reference: string | null
  external_issued_on: string | null
  external_file_path: string | null
  signoff_tasks: unknown
  signed_off_by: string | null
  signed_off_by_name: string | null
  signed_off_on: string | null
  supervised_only: boolean
  due_change_reason: string | null
  created_at: string
  updated_at: string
}

export interface TrainingAttemptRow {
  id: string
  assignment_id: string
  employee_id: string
  version_id: string
  section_key: string
  attempt_no: number
  served: unknown
  started_at: string
  submitted_at: string | null
  answers: unknown
  results: unknown
  wrong_count: number | null
  critical_missed: number | null
  passed: boolean | null
}

export interface TrainingEventRow {
  id: string
  employee_id: string | null
  assignment_id: string | null
  course_id: string | null
  event_type: string
  actor_id: string | null
  actor_name: string | null
  note_code: string | null
  note: string | null
  meta: unknown
  created_at: string
}

export interface TrainingReminderRow {
  id: string
  kind: string
  claim_key: string
  assignment_id: string | null
  employee_id: string | null
  london_date: string
  status: string
  detail: unknown
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------------------------
// Domain records (camelCase), produced by mappers.ts
// ---------------------------------------------------------------------------------------------

export interface TrainingCourse {
  id: string
  slug: string
  title: string
  kind: TrainingCourseKind
  audienceGroups: TrainingGroup[]
  audienceAge: TrainingAudienceAge
  isEssentials: boolean
  prerequisiteCourseId: string | null
  newStarterDueDays: number | null
  existingStaffDueDays: number | null
  refresherMonths: number | null
  windowDays: number
  supervisedOnlyUnder18: boolean
  displayOrder: number
  status: TrainingCourseStatus
  currentVersionId: string | null
  summary: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface TrainingCourseVersion {
  id: string
  courseId: string
  state: TrainingVersionState
  /** Null on a draft; set on a published version. */
  major: number | null
  minor: number | null
  content: CourseContent
  contentSha256: string
  images: VersionImage[]
  changeNote: string | null
  redoRequired: boolean
  uploadedBy: string | null
  uploadedByName: string | null
  uploadedAt: string
  publishedBy: string | null
  publishedByName: string | null
  publishedAt: string | null
}

/** A version without its content, for lists. */
export type TrainingCourseVersionMeta = Omit<TrainingCourseVersion, 'content'>

export interface TrainingProfile {
  employeeId: string
  /** Confirmed groups. Empty until a manager confirms; until then suggested groups apply. */
  groups: TrainingGroup[]
  groupsConfirmedAt: string | null
  groupsConfirmedBy: string | null
  groupsConfirmedByName: string | null
  pausedFrom: string | null
  pausedUntil: string | null
  pauseReason: PauseReason | null
  /** The adjustment applied (for example "read aloud"), never the health reason behind it. */
  adjustmentNote: string | null
  createdAt: string
  updatedAt: string
}

export interface TrainingAssignment {
  id: string
  employeeId: string
  courseId: string
  cycle: number
  reason: TrainingAssignmentReason
  status: TrainingAssignmentStatus
  assignedOn: string
  dueOn: string | null
  windowOpensOn: string | null
  /** The published version taken in this cycle; set at the first start and kept. */
  versionId: string | null
  progress: AssignmentProgress
  startedAt: string | null
  lastSectionPassedAt: string | null
  completedOn: string | null
  expiresOn: string | null
  certificateNumber: string | null
  signingDocumentId: string | null
  confirmedAt: string | null
  lockedAt: string | null
  lockedSection: string | null
  declinedAt: string | null
  waivedAt: string | null
  waivedBy: string | null
  waivedByName: string | null
  waiveReason: string | null
  cancelledAt: string | null
  cancelReason: TrainingCancelReason | null
  externalIssuer: string | null
  externalReference: string | null
  externalIssuedOn: string | null
  externalFilePath: string | null
  signoffTasks: SignoffTaskRecord[] | null
  signedOffBy: string | null
  signedOffByName: string | null
  signedOffOn: string | null
  supervisedOnly: boolean
  dueChangeReason: string | null
  createdAt: string
  updatedAt: string
}

/** The columns a service write may change on an assignment (everything but ids and timestamps). */
export type TrainingAssignmentPatch = Partial<
  Omit<TrainingAssignment, 'id' | 'employeeId' | 'courseId' | 'cycle' | 'createdAt' | 'updatedAt'>
>

export interface TrainingAttempt {
  id: string
  assignmentId: string
  employeeId: string
  versionId: string
  sectionKey: string
  attemptNo: number
  served: ServedQuestion[]
  startedAt: string
  submittedAt: string | null
  answers: AttemptAnswers | null
  results: AttemptResult[] | null
  wrongCount: number | null
  criticalMissed: number | null
  passed: boolean | null
}

export interface TrainingEvent {
  id: string
  employeeId: string | null
  assignmentId: string | null
  courseId: string | null
  eventType: TrainingEventType
  actorId: string | null
  actorName: string | null
  noteCode: string | null
  note: string | null
  meta: TrainingEventMeta
  createdAt: string
}

export interface TrainingReminder {
  id: string
  kind: TrainingReminderKind
  claimKey: string
  assignmentId: string | null
  employeeId: string | null
  londonDate: string
  status: TrainingReminderStatus
  detail: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------------------------
// Actors and inputs shared by the service and the actions
// ---------------------------------------------------------------------------------------------

/**
 * Who did something, as a snapshot: a user id with no foreign key and their name at the time.
 * System writes (the daily job, a completion hook) use `SYSTEM_ACTOR`.
 */
export interface Actor {
  id: string | null
  name: string
}

/** A signed-in member of staff acting in the app. */
export interface StaffActor extends Actor {
  id: string
}

export const SYSTEM_ACTOR: Actor = { id: null, name: 'System' }

/** A row to append to `training_events` (append-only). */
export interface NewTrainingEvent {
  eventType: TrainingEventType
  employeeId?: string | null
  assignmentId?: string | null
  courseId?: string | null
  actor?: Actor
  /** A short code from a fixed list, where one is needed. */
  noteCode?: string | null
  /** At most 500 characters; never a health detail. */
  note?: string | null
  meta?: TrainingEventMeta
}

export interface SyncOptions {
  /** Sync one person only. Leave out for everyone (the daily sweep). */
  employeeId?: string
  /** London date to sync as; defaults to today. */
  today?: string
  actor?: Actor
}

export interface SyncResult {
  created: number
  cancelled: number
  updated: number
}

/** The standard server action result (workspace rule). */
export type TrainingActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

/** A short reference to a course. */
export interface CourseRef {
  id: string
  slug: string
  title: string
}

/** A version's number and when it was published, for lists and certificates. */
export interface VersionRef {
  id: string
  major: number
  minor: number
  publishedAt: string
}

// ---------------------------------------------------------------------------------------------
// Manager views (src/app/actions/training.ts)
// ---------------------------------------------------------------------------------------------

/** One cell of the matrix: a person and a live course. */
export interface MatrixCell {
  courseId: string
  /** The cycle the cell describes (open first, else the latest), or null when there is none. */
  assignmentId: string | null
  state: TrainingDisplayState
  dueOn: string | null
  /** Whole days past `dueOn` when the state is overdue, else null. */
  daysOverdue: number | null
  completedOn: string | null
  expiresOn: string | null
  supervisedOnly: boolean
}

export interface MatrixCourse extends CourseRef {
  kind: TrainingCourseKind
  isEssentials: boolean
  displayOrder: number
  /** People the course applies to, paused people left out. */
  requiredCount: number
  /** Of those, how many hold a valid completion. */
  completedCount: number
  /** completedCount / requiredCount (0 to 1), or null when nobody is required. */
  completionRate: number | null
}

export interface MatrixPerson {
  employeeId: string
  name: string
  status: 'Active' | 'Started Separation'
  jobTitle: string | null
  /** The groups training uses: confirmed groups, or the suggested ones until confirmed. */
  groups: TrainingGroup[]
  suggestedGroups: TrainingGroup[]
  groupsConfirmed: boolean
  paused: boolean
  flags: TrainingPersonFlag[]
  /** Keyed by course id, one per live course. */
  cells: Record<string, MatrixCell>
}

/** Employees, Training: Active and Started Separation staff down the side, live courses across. */
export interface TrainingMatrix {
  /** The London date the states were worked out for. */
  today: string
  courses: MatrixCourse[]
  people: MatrixPerson[]
}

/** One section's progress and attempts, for the employee record. */
export interface SectionProgressView {
  key: string
  title: string
  passed: boolean
  passedAt: string | null
  /** Failed checks since the last unlock. */
  fails: number
  attempts: number
  /** Whether the first attempt passed, or null before any attempt was submitted. */
  firstAttemptPassed: boolean | null
}

/** One submitted or open check, for the record and the pay report. */
export interface AttemptSummary {
  id: string
  sectionKey: string
  sectionTitle: string
  attemptNo: number
  startedAt: string
  submittedAt: string | null
  wrongCount: number | null
  criticalMissed: number | null
  passed: boolean | null
  /** Whole minutes from start to submit, or null while open. */
  minutes: number | null
}

/** The signing document behind a cycle's confirmation or sign-off. */
interface CertificateRef {
  documentId: string
  status: SigningDocumentStatus
}

/** One cycle on the employee record. */
export interface EmployeeAssignmentItem {
  assignment: TrainingAssignment
  course: CourseRef & { kind: TrainingCourseKind; isEssentials: boolean }
  /** "1.0" for the version taken, or null before the first start. */
  versionLabel: string | null
  state: TrainingDisplayState
  /** The next staff reminder the ladder would send, or null when none would. */
  nextReminder: { step: StaffReminderStep; onDate: string } | null
  sections: SectionProgressView[]
  attempts: AttemptSummary[]
  certificate: CertificateRef | null
  /**
   * A practical course's tasks, in course order, from the version the cycle is pinned to (or the
   * course's current published version when none is pinned yet). Null for online and external
   * courses, and when there is no published version to read them from.
   */
  tasks: PracticalTask[] | null
}

/** The Training tab on an employee record. */
export interface EmployeeTrainingView {
  today: string
  employee: {
    employeeId: string
    name: string
    status: TrainingEmployeeStatus
    jobTitle: string | null
    startDate: string | null
    hasLogin: boolean
    dateOfBirthKnown: boolean
    /** True, false, or null when the date of birth is missing. */
    under18: boolean | null
  }
  profile: TrainingProfile | null
  suggestedGroups: TrainingGroup[]
  /** The groups training uses today. */
  groups: TrainingGroup[]
  groupsConfirmed: boolean
  /** The pause in force today, if any. */
  pause: { from: string; until: string | null; reason: PauseReason } | null
  flags: TrainingPersonFlag[]
  /** Open cycles, essentials first. */
  current: EmployeeAssignmentItem[]
  /** Closed cycles (completed, waived, cancelled), newest first. */
  history: EmployeeAssignmentItem[]
  /** Live courses with no open cycle for this person, for "Assign training". */
  assignable: CourseRef[]
}

/** One line of the training log. */
export interface ActivityItem {
  id: string
  createdAt: string
  eventType: TrainingEventType
  employeeId: string | null
  employeeName: string | null
  courseId: string | null
  courseTitle: string | null
  assignmentId: string | null
  actorName: string | null
  noteCode: string | null
  note: string | null
  meta: TrainingEventMeta
}

export interface ActivityPage {
  items: ActivityItem[]
  /** 1-based. */
  page: number
  pageSize: number
  total: number
}

/** One check that counts as training time. */
export interface PayReportEntry {
  attemptId: string
  /** London date of the start. */
  date: string
  courseTitle: string
  sectionTitle: string
  startedAt: string
  submittedAt: string
  minutes: number
  /** Minutes that fell outside a clocked or rostered shift. */
  minutesOutsideShifts: number
}

/** Training time per person for a pay period (spec 6.7). */
export interface PayReportRow {
  employeeId: string
  name: string
  minutesTotal: number
  minutesOutsideShifts: number
  entries: PayReportEntry[]
}

export interface PayReport {
  from: string
  to: string
  rows: PayReportRow[]
}

// ---------------------------------------------------------------------------------------------
// Course views (src/app/actions/training-courses.ts)
// ---------------------------------------------------------------------------------------------

export interface CourseListItem extends CourseRef {
  kind: TrainingCourseKind
  status: TrainingCourseStatus
  isEssentials: boolean
  audienceGroups: TrainingGroup[]
  audienceAge: TrainingAudienceAge
  refresherMonths: number | null
  displayOrder: number
  prerequisite: CourseRef | null
  currentVersion: VersionRef | null
  hasDraft: boolean
  draftUploadedAt: string | null
  /** Open cycles. */
  assignedCount: number
  /** People holding a valid (not expired) completion. */
  completedCount: number
}

export interface CourseStats {
  open: number
  overdue: number
  locked: number
  awaitingConfirmation: number
  declined: number
  completed: number
  expired: number
  waived: number
}

export interface CourseDetailView {
  course: TrainingCourse
  prerequisite: CourseRef | null
  current: TrainingCourseVersionMeta | null
  /** Published versions, newest first. */
  versions: TrainingCourseVersionMeta[]
  /** The draft re-checked in publish mode, so the page can show what still blocks publishing. */
  draft: {
    version: TrainingCourseVersionMeta
    errors: string[]
    warnings: string[]
    gaps: string[]
    publishable: boolean
  } | null
  stats: CourseStats
}

export interface UploadCourseDraftResult {
  /** Null when nothing was saved because of errors before the course could be identified. */
  slug: string | null
  courseId: string | null
  versionId: string | null
  saved: boolean
  errors: string[]
  warnings: string[]
  gaps: string[]
}

export interface PublishCourseResult {
  versionId: string
  major: number
  minor: number
  sync: SyncResult | null
}

// ---------------------------------------------------------------------------------------------
// The player and checks (portal and preview)
// ---------------------------------------------------------------------------------------------

/** A question as the learner sees it: displayed order, no answer. */
export interface CheckQuestionView {
  id: string
  prompt: string
  options: string[]
}

/** `startTrainingCheck`: the open attempt for a section (the same one again on reload). */
export interface StartCheckView {
  attemptId: string
  attemptNo: number
  questions: CheckQuestionView[]
}

/** `previewDraw`: a draw with nothing recorded. `served` is passed back to `previewScore`. */
export interface PreviewDrawView {
  served: ServedQuestion[]
  questions: CheckQuestionView[]
}

/** One marked question. `chosen` and `correctIndex` are DISPLAYED indexes. */
export interface CheckResultItem {
  questionId: string
  prompt: string
  options: string[]
  chosen: number
  correctIndex: number
  correct: boolean
  critical: boolean
  explanation: string
}

/** What a submitted (or previewed) check returns. */
export interface CheckResultView {
  passed: boolean
  wrongCount: number
  criticalMissed: number
  maxWrong: number
  results: CheckResultItem[]
  next: CheckNext
  /** `/portal/documents/<partyId>` when `next` is `confirm`. */
  confirmUrl?: string
}

/** A section as the player shows it: cards and objectives, never questions. */
export interface PlayerSectionContent {
  key: string
  title: string
  objectives: CourseObjective[]
  cards: CourseCard[]
  resitNote: string | null
  questionsPerAttempt: number
  maxWrong: number
}

/** A course version ready for the player, live or preview. */
export interface PlayerCourseView {
  versionId: string
  /** "1.0", or "Draft" for a draft preview. */
  versionLabel: string
  slug: string
  title: string
  summary: string
  kind: CourseFileKind
  estimatedMinutes: number
  intro: CourseCard[]
  sections: PlayerSectionContent[]
  closing: CourseCard[]
  /** Prefix for image cards: `${imageBaseUrl}${card.src}` (`/api/training/images/<versionId>/`). */
  imageBaseUrl: string
}

/** Where a section stands for the learner. */
export type PlayerSectionState = 'not_open' | 'open' | 'passed' | 'locked'

/** `getMyAssignment`: one cycle in the player. */
export interface MyAssignmentView {
  assignmentId: string
  courseId: string
  status: TrainingAssignmentStatus
  state: TrainingDisplayState
  dueOn: string | null
  course: PlayerCourseView
  progress: AssignmentProgress
  sectionStates: Record<string, PlayerSectionState>
  lockedSection: string | null
  /** The finish step: nothing yet, ready to confirm, preparing failed (try again), declined, or done. */
  confirmation: {
    state: 'not_ready' | 'ready' | 'retry' | 'declined' | 'done'
    confirmUrl: string | null
  }
}

/** Why an item sits in "waiting" on My Training. */
export type MyTrainingWaitingReason = 'prerequisite' | 'locked' | 'declined' | 'practical' | 'paused'

/** One line on My Training. */
export interface MyTrainingItem {
  assignmentId: string
  course: CourseRef & { kind: TrainingCourseKind; isEssentials: boolean; summary: string | null; estimatedMinutes: number | null }
  state: TrainingDisplayState
  dueOn: string | null
  completedOn: string | null
  expiresOn: string | null
  sectionsPassed: number
  sectionsTotal: number
  action: 'start' | 'continue' | 'confirm' | 'none'
  waitingReason: MyTrainingWaitingReason | null
  supervisedOnly: boolean
  /** The signing party for "View certificate" (`/portal/documents/<partyId>`), once confirmed. */
  certificatePartyId: string | null
}

/** `getMyTraining`. */
export interface MyTrainingView {
  today: string
  due: MyTrainingItem[]
  waiting: MyTrainingItem[]
  done: MyTrainingItem[]
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type TrainingErrorCode = 'not_found' | 'invalid' | 'conflict' | 'not_allowed' | 'not_ready' | 'unavailable'

/** A refusal the actions turn into a plain message for the person. */
export class TrainingError extends Error {
  readonly code: TrainingErrorCode

  constructor(code: TrainingErrorCode, message: string) {
    super(message)
    this.name = 'TrainingError'
    this.code = code
  }
}

/** A stored row that does not match its contract (a bug or a hand edit), raised by the mappers. */
export class TrainingDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainingDataError'
  }
}
