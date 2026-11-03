import { isValidIsoDate, shiftIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { disambiguatedNames, displayName } from '@/lib/employees/display-name'
import { SIGNING_OPEN_STATUSES, type SigningDocumentStatus } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { validateCourse } from '@/lib/training/course-schema'
import { ageOn, londonDateOf, trainingToday } from '@/lib/training/dates'
import {
  assignmentPatchToRow,
  emptyProgress,
  mapAssignmentRow,
  mapAttemptRow,
  mapCourseRow,
  mapCourseVersionMetaRow,
  mapCourseVersionRow,
  mapEventRow,
  mapProfileRow,
} from '@/lib/training/mappers'
import {
  forecastNextReminder,
  type ManagerDailyAssignment,
  type ManagerDailyInput,
  type ManagerDailyPerson,
  type StaffReminderItem,
  type StaffReminderPerson,
} from '@/lib/training/reminders'
import { getTrainingAutoAssignEnabled, getTrainingEmailsEnabled } from '@/lib/training/settings'
import {
  countsAsDone,
  displayStateFor,
  isOpenStatus,
  isPausedOn,
  pickDisplayAssignment,
  prerequisiteMet,
  prerequisiteOf,
  sectionStatesFor,
} from '@/lib/training/states'
import {
  courseAppliesTo,
  effectiveTrainingGroups,
  planAssignmentSync,
  suggestTrainingGroups,
  summariseAutoAssignChanges,
  summariseSyncActions,
  type SyncAction,
  type SyncAssignment,
  type SyncCourse,
  type SyncPerson,
} from '@/lib/training/sync'
import {
  OPEN_ASSIGNMENT_STATUSES,
  SYSTEM_ACTOR,
  TRAINING_IN_SCOPE_STATUSES,
  TrainingError,
  type ActivityItem,
  type ActivityPage,
  type Actor,
  type AttemptAnswers,
  type AttemptResult,
  type AttemptSummary,
  type AutoAssignPreview,
  type CourseContent,
  type CourseDetailView,
  type CourseListItem,
  type CourseRef,
  type CourseSection,
  type CourseStats,
  type EmployeeAssignmentItem,
  type EmployeeTrainingView,
  type MatrixCell,
  type MatrixCourse,
  type MatrixPerson,
  type MyAssignmentView,
  type MyTrainingItem,
  type MyTrainingView,
  type MyTrainingWaitingReason,
  type NewTrainingEvent,
  type PayReport,
  type PayReportEntry,
  type PayReportRow,
  type PlayerCourseView,
  type PracticalTask,
  type SectionProgressView,
  type ServedQuestion,
  type SyncOptions,
  type SyncResult,
  type TrainingAssignment,
  type TrainingAssignmentPatch,
  type TrainingAssignmentReason,
  type TrainingAssignmentRow,
  type TrainingAssignmentStatus,
  type TrainingAttempt,
  type TrainingAttemptRow,
  type TrainingAudienceAge,
  type TrainingCourse,
  type TrainingCourseKind,
  type TrainingCourseRow,
  type TrainingCourseStatus,
  type TrainingCourseVersion,
  type TrainingCourseVersionMeta,
  type TrainingCourseVersionRow,
  type TrainingDisplayState,
  type TrainingEmployeeStatus,
  type TrainingEvent,
  type TrainingEventRow,
  type TrainingGroup,
  type TrainingMatrix,
  type TrainingPersonFlag,
  type TrainingProfile,
  type TrainingProfileRow,
  type TrainingReminderKind,
  type TrainingReminderStatus,
  type VersionImage,
  type VersionRef,
} from '@/lib/training/types'

/**
 * Staff training reads and writes (build contract section 5.1). Every training table is service
 * role only, so this class uses the admin client inside and is called only from server actions,
 * route handlers, the daily job and signing hooks, each of which has already checked a
 * permission or the portal identity. Rows are mapped with src/lib/training/mappers.ts; rules come
 * from src/lib/training/{dates,states,sync,draw,scoring,reminders}.ts.
 *
 * Every write reads its `{ error }`; full reads page with `fetchAllRows`. A refusal the person
 * should see is a `TrainingError`; anything else throws a plain Error naming the table.
 *
 * Concurrency: the database is the referee. A second open cycle for a person and course is
 * refused by the unique index `training_assignments_one_open`, a second open attempt by
 * `training_attempts_one_open`, a second draft by `training_course_versions_one_draft`, and a
 * second claim by `training_reminders_claim`. Moves of one cycle are guarded on the status (and
 * the `updated_at`) the caller read, so two tabs, or a tab and the daily job, cannot both move it.
 */

export interface NewTrainingCourse {
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
  displayOrder?: number
  /** Defaults to `draft`. */
  status?: TrainingCourseStatus
  summary: string | null
  actor: Actor
}

/** Course columns a later write may change. The slug never changes. */
export type TrainingCoursePatch = Partial<
  Omit<TrainingCourse, 'id' | 'slug' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'>
>

export interface SaveDraftVersionInput {
  courseId: string
  content: CourseContent
  /** Lower-case hex SHA-256 of the stored content. */
  contentSha256: string
  images: VersionImage[]
  actor: Actor
}

export interface PublishDraftVersionInput {
  courseId: string
  draftVersionId: string
  major: number
  minor: number
  changeNote: string | null
  redoRequired: boolean
  /**
   * The draft's `uploaded_at` as read before it was checked. Every upload resets it, so the
   * publish only lands on that same draft (see `publishDraftVersion`).
   */
  expectedUploadedAt: string
  actor: Actor
}

export type TrainingProfilePatch = Partial<Omit<TrainingProfile, 'employeeId' | 'createdAt' | 'updatedAt'>>

export interface NewTrainingAssignment {
  employeeId: string
  courseId: string
  cycle: number
  reason: TrainingAssignmentReason
  status: TrainingAssignmentStatus
  assignedOn: string
  dueOn: string | null
  /** Any other columns to set at creation (external and manual cycles). */
  extra?: TrainingAssignmentPatch
}

/** Optimistic checks for `updateAssignment`: the write only lands when the row still matches. */
export interface AssignmentUpdateGuard {
  expectedStatuses?: readonly TrainingAssignmentStatus[]
  /** The `updated_at` the caller read. */
  expectedUpdatedAt?: string
}

export interface NewTrainingAttempt {
  assignmentId: string
  employeeId: string
  versionId: string
  sectionKey: string
  attemptNo: number
  served: ServedQuestion[]
}

export interface SubmitTrainingAttemptInput {
  submittedAt: string
  answers: AttemptAnswers
  results: AttemptResult[]
  wrongCount: number
  criticalMissed: number
  passed: boolean
}

export interface NewReminderClaim {
  kind: TrainingReminderKind
  claimKey: string
  londonDate: string
  assignmentId?: string | null
  employeeId?: string | null
  detail?: Record<string, unknown>
}

/** The employee fields the manager actions need (assign, sign-off, external, groups, pause). */
export interface TrainingPerson {
  employeeId: string
  name: string
  status: TrainingEmployeeStatus
  employmentStartDate: string | null
  dateOfBirth: string | null
}

/** An awaiting cycle with its signing document's status, for the daily finalise stage. */
export interface ConfirmationToFinalise {
  assignment: TrainingAssignment
  documentStatus: SigningDocumentStatus
}

// ---------------------------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

interface DbError {
  message: string
  code?: string | null
}

/** Ids per `.in()` request, so a long list never makes a URL too long for the gateway. */
const IN_CHUNK = 100

/** Rota departments from this many days back suggest training groups (spec 4.2). */
const ROTA_LOOKBACK_DAYS = 90

/** A pay report covers at most this many days, so one request cannot read the whole history. */
export const PAY_REPORT_MAX_DAYS = 93

const IN_SCOPE_STATUSES: readonly string[] = TRAINING_IN_SCOPE_STATUSES
const OPEN_STATUSES: readonly TrainingAssignmentStatus[] = OPEN_ASSIGNMENT_STATUSES

/** The rota status that means a shift is really on (src/lib/rota/shift-counting.ts). */
const ROSTERED_STATUS = 'scheduled'

const EMPLOYEE_COLUMNS =
  'employee_id, first_name, last_name, preferred_name, status, job_title, employment_start_date, date_of_birth, email_address, auth_user_id'

const VERSION_META_COLUMNS =
  'id, course_id, state, major, minor, content_sha256, images, change_note, redo_required, uploaded_by, uploaded_by_name, uploaded_at, published_by, published_by_name, published_at'

interface EmployeeRecord {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  status: string
  job_title: string | null
  employment_start_date: string | null
  date_of_birth: string | null
  email_address: string | null
  auth_user_id: string | null
}

interface PublishedVersionNumber {
  id: string
  course_id: string
  major: number
  minor: number
  redo_required: boolean
  published_at: string
}

/** A person with the groups training uses for them today. */
interface PersonContext {
  employee: EmployeeRecord
  status: TrainingEmployeeStatus
  profile: TrainingProfile | null
  suggestedGroups: TrainingGroup[]
  groups: TrainingGroup[]
  groupsConfirmed: boolean
  paused: boolean
}

function admin(): AdminClient {
  return createAdminClient()
}

function nowIso(): string {
  return new Date().toISOString()
}

/** A Postgres unique violation (23505), however PostgREST reports it. */
function isUniqueViolation(error: DbError | null | undefined): boolean {
  if (!error) return false
  if (error.code === '23505') return true
  return /duplicate key|unique constraint|violates unique/i.test(error.message ?? '')
}

/** Throws a plain Error naming the table and what was being done. */
function dbFailure(table: string, what: string, error: DbError): never {
  throw new Error(`[${table}] ${what} failed: ${error.message}`)
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

function chunked<T>(values: readonly T[], size = IN_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function asEmployeeStatus(status: string): TrainingEmployeeStatus {
  if (status === 'Onboarding' || status === 'Active' || status === 'Started Separation' || status === 'Former') return status
  // An unknown status is treated as not in scope, never as Active.
  return 'Former'
}

function versionLabelOf(version: { major: number | null; minor: number | null } | null | undefined): string | null {
  if (!version || version.major === null || version.minor === null) return null
  return `${version.major}.${version.minor}`
}

function compareCourses(a: TrainingCourse, b: TrainingCourse): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  return a.title.localeCompare(b.title, 'en-GB')
}

function courseRef(course: TrainingCourse): CourseRef {
  return { id: course.id, slug: course.slug, title: course.title }
}

/**
 * Whether sync assigns a course to its audience. Online and practical courses always do. An
 * external qualification has no column for the `required` choice, so it is read from its
 * deadline: a required external qualification is created with a due-day rule (a number of days,
 * 0 included), one recorded by hand only with both rules null.
 */
function courseAssignsAutomatically(
  course: Pick<TrainingCourse, 'kind' | 'newStarterDueDays' | 'existingStaffDueDays'>
): boolean {
  if (course.kind !== 'external') return true
  return course.newStarterDueDays !== null || course.existingStaffDueDays !== null
}

function sectionTitleOf(content: CourseContent | null | undefined, sectionKey: string): string {
  return content?.sections.find((section) => section.key === sectionKey)?.title ?? sectionKey
}

function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000))
}

/** Merges overlapping [start, end) millisecond windows. */
function mergeWindows(windows: Array<[number, number]>): Array<[number, number]> {
  const sorted = windows.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** Milliseconds of [start, end) that no window covers. Windows must be merged. */
function msOutside(start: number, end: number, windows: Array<[number, number]>): number {
  let covered = 0
  for (const [windowStart, windowEnd] of windows) {
    const overlap = Math.min(end, windowEnd) - Math.max(start, windowStart)
    if (overlap > 0) covered += overlap
  }
  return Math.max(0, end - start - covered)
}

function addDaysOrThrow(isoDate: string, days: number): string {
  const moved = shiftIsoDate(isoDate, days)
  if (moved === null) throw new TrainingError('invalid', `Not a real date: ${isoDate}`)
  return moved
}

// ---------------------------------------------------------------------------------------------
// Row loaders shared by several reads (each names its table in the chain, for the column guard)
// ---------------------------------------------------------------------------------------------

async function loadEmployeesByIds(client: AdminClient, ids: readonly string[]): Promise<EmployeeRecord[]> {
  const rows: EmployeeRecord[] = []
  for (const chunk of chunked(unique(ids))) {
    const { data, error } = await client.from('employees').select(EMPLOYEE_COLUMNS).in('employee_id', chunk)
    if (error) dbFailure('employees', 'Reading employees', error)
    rows.push(...((data ?? []) as EmployeeRecord[]))
  }
  return rows
}

async function loadEmployeesByStatus(client: AdminClient, statuses: readonly string[]): Promise<EmployeeRecord[]> {
  return fetchAllRows<EmployeeRecord>(
    (from, to) =>
      client
        .from('employees')
        .select(EMPLOYEE_COLUMNS)
        .in('status', [...statuses])
        .order('employee_id', { ascending: true })
        .range(from, to),
    { label: 'training: in-scope employees' }
  )
}

async function loadEmployee(client: AdminClient, employeeId: string): Promise<EmployeeRecord | null> {
  const { data, error } = await client.from('employees').select(EMPLOYEE_COLUMNS).eq('employee_id', employeeId).maybeSingle()
  if (error) dbFailure('employees', 'Reading the employee', error)
  return (data as EmployeeRecord | null) ?? null
}

async function loadAllAssignments(client: AdminClient, filter: { employeeId?: string; courseId?: string } = {}): Promise<TrainingAssignment[]> {
  const rows = await fetchAllRows<TrainingAssignmentRow>(
    (from, to) => {
      let query = client.from('training_assignments').select('*')
      if (filter.employeeId) query = query.eq('employee_id', filter.employeeId)
      if (filter.courseId) query = query.eq('course_id', filter.courseId)
      return query.order('id', { ascending: true }).range(from, to)
    },
    { label: 'training: assignments' }
  )
  return rows.map(mapAssignmentRow)
}

async function loadOpenAssignments(client: AdminClient): Promise<TrainingAssignment[]> {
  const rows = await fetchAllRows<TrainingAssignmentRow>(
    (from, to) =>
      client
        .from('training_assignments')
        .select('*')
        .in('status', [...OPEN_STATUSES])
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'training: open assignments' }
  )
  return rows.map(mapAssignmentRow)
}

async function loadProfiles(client: AdminClient, employeeIds: readonly string[] | null): Promise<Map<string, TrainingProfile>> {
  const profiles = new Map<string, TrainingProfile>()
  if (employeeIds === null) {
    const rows = await fetchAllRows<TrainingProfileRow>(
      (from, to) => client.from('training_profiles').select('*').order('employee_id', { ascending: true }).range(from, to),
      { label: 'training: profiles' }
    )
    for (const row of rows) profiles.set(row.employee_id, mapProfileRow(row))
    return profiles
  }
  for (const chunk of chunked(unique(employeeIds))) {
    const { data, error } = await client.from('training_profiles').select('*').in('employee_id', chunk)
    if (error) dbFailure('training_profiles', 'Reading training profiles', error)
    for (const row of (data ?? []) as TrainingProfileRow[]) profiles.set(row.employee_id, mapProfileRow(row))
  }
  return profiles
}

async function loadCourses(client: AdminClient, statuses?: readonly TrainingCourseStatus[]): Promise<TrainingCourse[]> {
  let query = client.from('training_courses').select('*')
  if (statuses) query = query.in('status', [...statuses])
  const { data, error } = await query.order('display_order', { ascending: true }).order('title', { ascending: true })
  if (error) dbFailure('training_courses', 'Reading courses', error)
  return ((data ?? []) as TrainingCourseRow[]).map(mapCourseRow).sort(compareCourses)
}

async function loadPublishedVersionNumbers(client: AdminClient, courseIds: readonly string[]): Promise<PublishedVersionNumber[]> {
  const rows: PublishedVersionNumber[] = []
  for (const chunk of chunked(unique(courseIds))) {
    const { data, error } = await client
      .from('training_course_versions')
      .select('id, course_id, major, minor, redo_required, published_at')
      .eq('state', 'published')
      .in('course_id', chunk)
    if (error) dbFailure('training_course_versions', 'Reading published version numbers', error)
    rows.push(...((data ?? []) as PublishedVersionNumber[]))
  }
  return rows
}

/** Versions with their content, by id. Missing ids are left out. */
async function loadVersionsWithContent(client: AdminClient, versionIds: readonly string[]): Promise<Map<string, TrainingCourseVersion>> {
  const versions = new Map<string, TrainingCourseVersion>()
  for (const chunk of chunked(unique(versionIds.filter(Boolean)))) {
    const { data, error } = await client.from('training_course_versions').select('*').in('id', chunk)
    if (error) dbFailure('training_course_versions', 'Reading course versions', error)
    for (const row of (data ?? []) as TrainingCourseVersionRow[]) versions.set(row.id, mapCourseVersionRow(row))
  }
  return versions
}

/** Rota departments each person worked in the last 90 days, for suggested training groups. */
async function loadRecentRotaDepartments(
  client: AdminClient,
  employeeIds: readonly string[] | null,
  today: string
): Promise<Map<string, string[]>> {
  const since = addDaysOrThrow(today, -ROTA_LOOKBACK_DAYS)
  const departments = new Map<string, Set<string>>()
  const add = (rows: Array<{ employee_id: string | null; department: string | null }>): void => {
    for (const row of rows) {
      if (!row.employee_id || !row.department) continue
      const set = departments.get(row.employee_id) ?? new Set<string>()
      set.add(row.department)
      departments.set(row.employee_id, set)
    }
  }
  if (employeeIds === null) {
    add(
      await fetchAllRows<{ employee_id: string | null; department: string | null }>(
        (from, to) =>
          client
            .from('rota_published_shifts')
            .select('employee_id, department')
            .gte('shift_date', since)
            .lte('shift_date', today)
            .eq('status', ROSTERED_STATUS)
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'training: recent rota departments' }
      )
    )
  } else {
    for (const chunk of chunked(unique(employeeIds))) {
      add(
        await fetchAllRows<{ employee_id: string | null; department: string | null }>(
          (from, to) =>
            client
              .from('rota_published_shifts')
              .select('employee_id, department')
              .in('employee_id', chunk)
              .gte('shift_date', since)
              .lte('shift_date', today)
              .eq('status', ROSTERED_STATUS)
              .order('id', { ascending: true })
              .range(from, to),
          { label: 'training: recent rota departments' }
        )
      )
    }
  }
  return new Map([...departments].map(([employeeId, set]) => [employeeId, [...set].sort()]))
}

interface SigningStatusRow {
  id: string
  status: string
  expires_at: string | null
}

/**
 * A signing document's status as it stands now. One still open past its link expiry reads as
 * `expired`, because the signing feature already refuses to sign it, although the daily sweep that
 * marks it expired may not have run yet.
 */
function effectiveSigningStatus(row: SigningStatusRow, nowMs: number): SigningDocumentStatus {
  const status = row.status as SigningDocumentStatus
  if (!SIGNING_OPEN_STATUSES.includes(status) || !row.expires_at) return status
  const expires = Date.parse(row.expires_at)
  return Number.isFinite(expires) && expires <= nowMs ? 'expired' : status
}

/** Each document's status as it stands now (see `effectiveSigningStatus`). Missing ids are left out. */
async function loadSigningStatuses(client: AdminClient, documentIds: readonly string[]): Promise<Map<string, SigningDocumentStatus>> {
  const statuses = new Map<string, SigningDocumentStatus>()
  const nowMs = Date.now()
  for (const chunk of chunked(unique(documentIds.filter(Boolean)))) {
    const { data, error } = await client.from('signing_documents').select('id, status, expires_at').in('id', chunk)
    if (error) dbFailure('signing_documents', 'Reading signing document statuses', error)
    for (const row of (data ?? []) as SigningStatusRow[]) {
      statuses.set(row.id, effectiveSigningStatus(row, nowMs))
    }
  }
  return statuses
}

/** The worker's signing party on each document (for `/portal/documents/<partyId>`). */
async function loadWorkerParties(
  client: AdminClient,
  documentIds: readonly string[],
  employeeId: string
): Promise<Map<string, string>> {
  const parties = new Map<string, string>()
  for (const chunk of chunked(unique(documentIds.filter(Boolean)))) {
    const { data, error } = await client
      .from('signing_parties')
      .select('id, document_id')
      .in('document_id', chunk)
      .eq('employee_id', employeeId)
      .eq('role', 'worker')
    if (error) dbFailure('signing_parties', 'Reading signing parties', error)
    for (const row of (data ?? []) as Array<{ id: string; document_id: string }>) parties.set(row.document_id, row.id)
  }
  return parties
}

async function loadSuppressedEmails(client: AdminClient, emails: readonly string[]): Promise<Set<string>> {
  const suppressed = new Set<string>()
  const normalised = unique(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))
  for (const chunk of chunked(normalised)) {
    const { data, error } = await client.from('email_suppressions').select('email').in('email', chunk)
    if (error) dbFailure('email_suppressions', 'Reading suppressed addresses', error)
    for (const row of (data ?? []) as Array<{ email: string }>) suppressed.add(row.email.trim().toLowerCase())
  }
  return suppressed
}

function personContext(
  employee: EmployeeRecord,
  profile: TrainingProfile | null,
  rotaDepartments: readonly string[],
  today: string
): PersonContext {
  const suggestedGroups = suggestTrainingGroups({ jobTitle: employee.job_title, recentRotaDepartments: rotaDepartments })
  const effective = effectiveTrainingGroups(profile, suggestedGroups)
  return {
    employee,
    status: asEmployeeStatus(employee.status),
    profile,
    suggestedGroups,
    groups: effective.groups,
    groupsConfirmed: effective.confirmed,
    paused: isPausedOn(profile, today),
  }
}

/**
 * Whether a course applies to a person today, for the matrix and the record. `inAudience` is the
 * course's audience and age rule alone. `applies` also needs the person to be Active, because only
 * Active staff are given new cycles: someone working their notice (Started Separation) keeps what
 * is open and is given nothing new.
 */
function appliesForDisplay(
  course: TrainingCourse,
  person: PersonContext,
  today: string
): { inAudience: boolean; applies: boolean; dobMissing: boolean } {
  if (course.status !== 'live' || !courseAssignsAutomatically(course)) return { inAudience: false, applies: false, dobMissing: false }
  const result = courseAppliesTo(course, { groups: person.groups, dateOfBirth: person.employee.date_of_birth }, today)
  return { inAudience: result.applies, applies: result.applies && person.status === 'Active', dobMissing: result.dobMissing }
}

/**
 * A matrix cell's state. `displayStateFor` covers everyone except one case: a course still in the
 * person's audience for someone who is given no new cycles (Started Separation). With a cycle open
 * it reads as usual. With none open, nothing new will be opened, so the last result shows as it
 * stands: `expired` once its expiry has passed (they may still be working shifts), `done` while it
 * is in date, inside the refresher window too (no refresher will be opened), and `not_required`
 * when there is no result to show. A course no longer in their audience keeps displayStateFor's
 * own `not_required` rule.
 */
function matrixStateFor(input: {
  cycles: readonly TrainingAssignment[]
  inAudience: boolean
  applies: boolean
  paused: boolean
  /** `prerequisiteMet` for this course and person today. */
  prerequisiteValid: boolean
  today: string
}): TrainingDisplayState {
  const { cycles, inAudience, applies, paused, prerequisiteValid, today } = input
  if (applies || !inAudience || cycles.some((cycle) => isOpenStatus(cycle.status))) {
    return displayStateFor({ assignments: cycles, applies, paused, prerequisiteValid, today })
  }
  const state = displayStateFor({ assignments: cycles, applies: true, paused, prerequisiteValid, today })
  if (state === 'refresher_due') return 'done'
  if (state === 'not_started') return 'not_required'
  return state
}

function personFlags(person: PersonContext, dobMissing: boolean): TrainingPersonFlag[] {
  const flags: TrainingPersonFlag[] = []
  if (!person.groupsConfirmed) flags.push('groups_not_confirmed')
  if (!person.employee.auth_user_id) flags.push('no_login')
  if (dobMissing) flags.push('dob_missing')
  return flags
}

function groupByCourse(assignments: readonly TrainingAssignment[]): Map<string, TrainingAssignment[]> {
  const byCourse = new Map<string, TrainingAssignment[]>()
  for (const assignment of assignments) {
    const list = byCourse.get(assignment.courseId) ?? []
    list.push(assignment)
    byCourse.set(assignment.courseId, list)
  }
  return byCourse
}

function latestCompleted(assignments: readonly TrainingAssignment[]): TrainingAssignment | null {
  return [...assignments].filter((assignment) => assignment.status === 'completed').sort((a, b) => b.cycle - a.cycle)[0] ?? null
}

function attemptSummary(attempt: TrainingAttempt, content: CourseContent | null): AttemptSummary {
  return {
    id: attempt.id,
    sectionKey: attempt.sectionKey,
    sectionTitle: sectionTitleOf(content, attempt.sectionKey),
    attemptNo: attempt.attemptNo,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    wrongCount: attempt.wrongCount,
    criticalMissed: attempt.criticalMissed,
    passed: attempt.passed,
    minutes: attempt.submittedAt ? minutesBetween(attempt.startedAt, attempt.submittedAt) : null,
  }
}

function sectionViews(content: CourseContent | null, assignment: TrainingAssignment, attempts: readonly TrainingAttempt[]): SectionProgressView[] {
  if (!content || content.kind !== 'online') return []
  return content.sections.map((section) => {
    const progress = assignment.progress.sections[section.key]
    const own = attempts.filter((attempt) => attempt.sectionKey === section.key)
    const first = own.find((attempt) => attempt.attemptNo === 1 && attempt.submittedAt !== null)
    return {
      key: section.key,
      title: section.title,
      passed: Boolean(progress?.passedAt),
      passedAt: progress?.passedAt ?? null,
      fails: progress?.fails ?? 0,
      attempts: own.filter((attempt) => attempt.submittedAt !== null).length,
      firstAttemptPassed: first ? first.passed === true : null,
    }
  })
}

/**
 * A practical course's tasks from a published version, in course order, for the sign-off form.
 * Null for any other kind of course, or when there is no published version to read.
 */
function practicalTasksFrom(course: TrainingCourse, version: TrainingCourseVersion | null): PracticalTask[] | null {
  if (course.kind !== 'practical' || !version || version.state !== 'published') return null
  if (version.content.kind !== 'practical') return null
  return version.content.tasks.map((task) => ({ key: task.key, text: task.text }))
}

/** Sections passed, total and the current section's title, for reminders and My Training. */
function progressSummary(content: CourseContent | null, assignment: TrainingAssignment): StaffReminderItem['progress'] {
  const sections: CourseSection[] = content?.kind === 'online' ? content.sections : []
  const passed = sections.filter((section) => Boolean(assignment.progress.sections[section.key]?.passedAt))
  const current = sections.find((section) => !assignment.progress.sections[section.key]?.passedAt) ?? null
  return {
    sectionsPassed: passed.length,
    sectionsTotal: sections.length,
    currentSectionTitle: assignment.startedAt ? current?.title ?? null : null,
  }
}

function playerCourseFrom(version: TrainingCourseVersion): PlayerCourseView {
  const content = version.content
  return {
    versionId: version.id,
    versionLabel: version.state === 'draft' ? 'Draft' : versionLabelOf(version) ?? 'Draft',
    slug: content.slug,
    title: content.title,
    summary: content.summary,
    kind: content.kind,
    estimatedMinutes: content.estimatedMinutes,
    intro: content.intro,
    sections: content.sections.map((section) => ({
      key: section.key,
      title: section.title,
      objectives: section.objectives,
      cards: section.cards,
      resitNote: section.resitNote ?? null,
      questionsPerAttempt: section.check.questionsPerAttempt,
      maxWrong: section.check.maxWrong,
    })),
    closing: content.closing,
    imageBaseUrl: `/api/training/images/${version.id}/`,
  }
}

const COURSE_PATCH_COLUMNS: Record<keyof TrainingCoursePatch, string> = {
  title: 'title',
  kind: 'kind',
  audienceGroups: 'audience_groups',
  audienceAge: 'audience_age',
  isEssentials: 'is_essentials',
  prerequisiteCourseId: 'prerequisite_course_id',
  newStarterDueDays: 'new_starter_due_days',
  existingStaffDueDays: 'existing_staff_due_days',
  refresherMonths: 'refresher_months',
  windowDays: 'window_days',
  supervisedOnlyUnder18: 'supervised_only_under_18',
  displayOrder: 'display_order',
  status: 'status',
  currentVersionId: 'current_version_id',
  summary: 'summary',
}

const PROFILE_PATCH_COLUMNS: Record<keyof TrainingProfilePatch, string> = {
  groups: 'groups',
  groupsConfirmedAt: 'groups_confirmed_at',
  groupsConfirmedBy: 'groups_confirmed_by',
  groupsConfirmedByName: 'groups_confirmed_by_name',
  pausedFrom: 'paused_from',
  pausedUntil: 'paused_until',
  pauseReason: 'pause_reason',
  adjustmentNote: 'adjustment_note',
}

function patchToRow<P extends object>(patch: P, columns: Record<keyof P, string>, table: string): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const column = columns[field as keyof P]
    if (!column) throw new TrainingError('invalid', `${table}: no column for "${field}"`)
    row[column] = value
  }
  return row
}

/** What one sync run reads (`loadSyncSnapshot`): every cycle in scope, and the people and courses as sync sees them. */
interface SyncSnapshot {
  assignments: TrainingAssignment[]
  profiles: Map<string, TrainingProfile>
  people: SyncPerson[]
  courses: SyncCourse[]
}

/**
 * Loads what `planAssignmentSync` reads: in-scope employees (or the one `employeeId`), plus anyone
 * else still holding an open cycle, their profiles and every cycle, live and retired courses with
 * their version numbers, and recent rota departments. Null when there is nobody to sync. Read only.
 */
async function loadSyncSnapshot(client: AdminClient, today: string, employeeId: string | null): Promise<SyncSnapshot | null> {
  // 1. Every cycle in scope of this run.
  const assignments = await loadAllAssignments(client, employeeId ? { employeeId } : {})

  // 2. The people: one person, or everyone in scope plus anyone else still holding an open cycle.
  let employees: EmployeeRecord[]
  if (employeeId) {
    const one = await loadEmployee(client, employeeId)
    employees = one ? [one] : []
  } else {
    employees = await loadEmployeesByStatus(client, IN_SCOPE_STATUSES)
    const known = new Set(employees.map((employee) => employee.employee_id))
    const strays = unique(
      assignments.filter((assignment) => isOpenStatus(assignment.status) && !known.has(assignment.employeeId)).map((a) => a.employeeId)
    )
    if (strays.length) employees = [...employees, ...(await loadEmployeesByIds(client, strays))]
  }
  if (employees.length === 0) return null
  const employeeIds = employees.map((employee) => employee.employee_id)

  // 3. Profiles, courses, version numbers and rota.
  const profiles = await loadProfiles(client, employeeId ? employeeIds : null)
  const courses = await loadCourses(client, ['live', 'retired'])
  const versions = await loadPublishedVersionNumbers(client, courses.map((course) => course.id))
  const rota = await loadRecentRotaDepartments(client, employeeId ? employeeIds : null, today)

  const versionById = new Map(versions.map((version) => [version.id, version]))
  const syncCourses: SyncCourse[] = courses.map((course) => {
    const own = versions.filter((version) => version.course_id === course.id)
    const firstPublish = own.map((version) => version.published_at).sort()[0] ?? null
    const redo = own
      .filter((version) => version.redo_required)
      .sort((a, b) => b.major - a.major || b.minor - a.minor)[0]
    return {
      id: course.id,
      slug: course.slug,
      kind: course.kind,
      status: course.status,
      audienceGroups: course.audienceGroups,
      audienceAge: course.audienceAge,
      isEssentials: course.isEssentials,
      prerequisiteCourseId: course.prerequisiteCourseId,
      newStarterDueDays: course.newStarterDueDays,
      existingStaffDueDays: course.existingStaffDueDays,
      wentLiveOn: firstPublish
        ? londonDateOf(firstPublish)
        : course.kind === 'external'
          ? londonDateOf(course.createdAt)
          : null,
      assignAutomatically: courseAssignsAutomatically(course),
      latestRedoVersion: redo ? { id: redo.id, major: redo.major, minor: redo.minor } : null,
      refresherMonths: course.refresherMonths,
      windowDays: course.windowDays,
    }
  })

  const byEmployee = new Map<string, TrainingAssignment[]>()
  for (const assignment of assignments) {
    const list = byEmployee.get(assignment.employeeId) ?? []
    list.push(assignment)
    byEmployee.set(assignment.employeeId, list)
  }
  const people: SyncPerson[] = employees.map((employee) => ({
    employee: {
      employeeId: employee.employee_id,
      status: asEmployeeStatus(employee.status),
      employmentStartDate: employee.employment_start_date,
      dateOfBirth: employee.date_of_birth,
      jobTitle: employee.job_title,
      recentRotaDepartments: rota.get(employee.employee_id) ?? [],
    },
    profile: profiles.get(employee.employee_id) ?? null,
    assignments: (byEmployee.get(employee.employee_id) ?? []).map((assignment): SyncAssignment => {
      const taken = assignment.versionId ? versionById.get(assignment.versionId) : undefined
      // Built as a value first so a field the engine does not read yet (startedAt) is passed
      // without an excess-property error, whichever fields SyncAssignment picks.
      const synced = {
        id: assignment.id,
        courseId: assignment.courseId,
        cycle: assignment.cycle,
        status: assignment.status,
        reason: assignment.reason,
        dueOn: assignment.dueOn,
        startedAt: assignment.startedAt,
        completedOn: assignment.completedOn,
        expiresOn: assignment.expiresOn,
        windowOpensOn: assignment.windowOpensOn,
        versionId: assignment.versionId,
        versionNumber: taken ? { major: taken.major, minor: taken.minor } : null,
      }
      return synced
    }),
  }))

  return { assignments, profiles, people, courses: syncCourses }
}

// ---------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------

export class TrainingService {
  // -------------------------------------------------------------------------------------------
  // Assignment sync
  // -------------------------------------------------------------------------------------------

  /**
   * Loads the snapshot (in-scope employees, profiles, every cycle, live and retired courses,
   * recent rota departments), runs `planAssignmentSync`, applies each action, and writes an event
   * for each (`assigned`, `cancelled`, `resumed`). Safe to run twice: the one-open-cycle index
   * makes a repeated create a no-op. `employeeId` limits it to one person.
   *
   * Each action is applied on its own; one that fails does not stop the rest. When any failed,
   * this throws after applying the others, so the daily job counts the failure.
   *
   * The `training_auto_assign_enabled` switch is read once, here, unless the caller passes it
   * (`autoAssign`); unreadable is off. While it is off nothing is created for anyone (see
   * `planAssignmentSync`); cancelling, ending pauses and releasing a manager's waiting cycle go on.
   */
  static async syncAssignments(opts: SyncOptions = {}): Promise<SyncResult> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const actor = opts.actor ?? SYSTEM_ACTOR
    const autoAssign = opts.autoAssign ?? (await getTrainingAutoAssignEnabled(client))

    const snapshot = await loadSyncSnapshot(client, today, opts.employeeId ?? null)
    if (!snapshot) return { created: 0, cancelled: 0, updated: 0 }
    const { assignments, profiles, people, courses } = snapshot

    // Plan and apply.
    const actions = planAssignmentSync({ today, people, courses, autoAssign })
    const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]))
    const applied: SyncAction[] = []
    const failures: string[] = []

    for (const action of actions) {
      try {
        const done = await TrainingService.applySyncAction(client, action, { today, actor, assignmentById, profiles })
        if (done) applied.push(action)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[training] sync action failed', {
          type: action.type,
          employeeId: action.employeeId,
          courseId: 'courseId' in action ? action.courseId : null,
          message,
        })
        failures.push(`${action.type}: ${message}`)
      }
    }

    const result = summariseSyncActions(applied)
    if (failures.length) {
      throw new Error(
        `Training sync applied ${applied.length} change(s) but ${failures.length} failed (created ${result.created}, cancelled ${result.cancelled}, updated ${result.updated}). First failure: ${failures[0]}`
      )
    }
    return result
  }

  /**
   * What switching automatic assignment on would give out at the next sync for everyone, worked
   * out without changing anything: the same snapshot `syncAssignments` reads, planned with the
   * switch on and with it off, and the difference counted (`summariseAutoAssignChanges`). Read
   * only: nothing is written and no event is recorded.
   */
  static async previewAutoAssign(opts: { today?: string } = {}): Promise<AutoAssignPreview> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const snapshot = await loadSyncSnapshot(client, today, null)
    if (!snapshot) return summariseAutoAssignChanges([], [])
    const { people, courses } = snapshot
    return summariseAutoAssignChanges(
      planAssignmentSync({ today, people, courses, autoAssign: true }),
      planAssignmentSync({ today, people, courses, autoAssign: false })
    )
  }

  /** Applies one planned change. False when the database shows someone else already made it. */
  private static async applySyncAction(
    client: AdminClient,
    action: SyncAction,
    context: {
      today: string
      actor: Actor
      assignmentById: Map<string, TrainingAssignment>
      profiles: Map<string, TrainingProfile>
    }
  ): Promise<boolean> {
    const { today, actor } = context
    switch (action.type) {
      case 'create': {
        const { data, error } = await client
          .from('training_assignments')
          .insert({
            employee_id: action.employeeId,
            course_id: action.courseId,
            cycle: action.cycle,
            reason: action.reason,
            status: action.status,
            assigned_on: action.assignedOn,
            due_on: action.dueOn,
            progress: emptyProgress(),
          })
          .select('id')
          .single()
        // Another run (or a manager) opened a cycle first: the one-open index refused ours.
        if (error && isUniqueViolation(error)) return false
        if (error) dbFailure('training_assignments', 'Creating a cycle', error)
        const created = data as { id: string }
        await TrainingService.writeEvent({
          eventType: 'assigned',
          employeeId: action.employeeId,
          courseId: action.courseId,
          assignmentId: created.id,
          actor,
          noteCode: action.reason,
          meta: { cycle: action.cycle, reason: action.reason, status: action.status, dueOn: action.dueOn },
        })
        return true
      }

      case 'cancel': {
        const { data, error } = await client
          .from('training_assignments')
          .update({ status: 'cancelled', cancelled_at: nowIso(), cancel_reason: action.reason })
          .eq('id', action.assignmentId)
          .in('status', [...OPEN_STATUSES])
          .select('id')
        if (error) dbFailure('training_assignments', 'Cancelling a cycle', error)
        if (((data ?? []) as unknown[]).length === 0) return false
        await TrainingService.writeEvent({
          eventType: 'cancelled',
          employeeId: action.employeeId,
          courseId: action.courseId,
          assignmentId: action.assignmentId,
          actor,
          noteCode: action.reason,
        })
        return true
      }

      case 'release': {
        // Assigned from today: the course could not be started before, so the record's
        // "Assigned" date and the reminder ladder (the nudge 3 days after assignment) count from
        // the release, not from the day the waiting cycle was made.
        const { data, error } = await client
          .from('training_assignments')
          .update({ status: 'assigned', assigned_on: today, due_on: action.dueOn })
          .eq('id', action.assignmentId)
          .eq('status', 'waiting')
          .select('id')
        if (error) dbFailure('training_assignments', 'Releasing a waiting cycle', error)
        if (((data ?? []) as unknown[]).length === 0) return false
        await TrainingService.writeEvent({
          eventType: 'assigned',
          employeeId: action.employeeId,
          courseId: action.courseId,
          assignmentId: action.assignmentId,
          actor,
          noteCode: 'prerequisite_met',
          meta: { released: true, assignedOn: today, dueOn: action.dueOn },
        })
        return true
      }

      case 'end_pause': {
        const profile = context.profiles.get(action.employeeId)
        // Due dates first: each is the later of itself and resume + 14, so applying it twice
        // gives the same date. Each is guarded on the due date read, so a manager's extension
        // made in between is never pulled back.
        let moved = 0
        for (const change of action.dueChanges) {
          const before = context.assignmentById.get(change.assignmentId)
          if (!before || before.dueOn === change.dueOn) continue
          let query = client
            .from('training_assignments')
            .update({ due_on: change.dueOn, due_change_reason: 'Pause ended' })
            .eq('id', change.assignmentId)
            .in('status', [...OPEN_STATUSES])
          query = before.dueOn === null ? query.is('due_on', null) : query.eq('due_on', before.dueOn)
          const { data, error } = await query.select('id')
          if (error) dbFailure('training_assignments', 'Moving a due date after a pause', error)
          moved += ((data ?? []) as unknown[]).length
        }
        // Then the pause itself, guarded on the end date read, so two runs end it once.
        let clear = client
          .from('training_profiles')
          .update({ paused_from: null, paused_until: null, pause_reason: null })
          .eq('employee_id', action.employeeId)
        clear = profile?.pausedUntil ? clear.eq('paused_until', profile.pausedUntil) : clear.not('paused_until', 'is', null)
        const { data, error } = await clear.select('employee_id')
        if (error) dbFailure('training_profiles', 'Ending a pause', error)
        if (((data ?? []) as unknown[]).length === 0) return moved > 0
        await TrainingService.writeEvent({
          eventType: 'resumed',
          employeeId: action.employeeId,
          actor,
          noteCode: 'pause_ended',
          meta: { resumedOn: action.resumedOn, today, dueDatesMoved: moved },
        })
        return true
      }

      case 'flag':
        // Flags are worked out again on every read; nothing is stored.
        return false

      default: {
        const unknownAction: never = action
        throw new Error(`Unknown sync action ${JSON.stringify(unknownAction)}`)
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Events (append-only)
  // -------------------------------------------------------------------------------------------

  /** Appends one `training_events` row. Throws when the insert fails: the event is the record. */
  static async writeEvent(event: NewTrainingEvent): Promise<TrainingEvent> {
    const note = event.note?.trim() ? event.note.trim() : null
    if (note !== null && note.length > 500) {
      throw new TrainingError('invalid', 'A training note can be at most 500 characters.')
    }
    const actor = event.actor ?? SYSTEM_ACTOR
    const { data, error } = await admin()
      .from('training_events')
      .insert({
        event_type: event.eventType,
        employee_id: event.employeeId ?? null,
        assignment_id: event.assignmentId ?? null,
        course_id: event.courseId ?? null,
        actor_id: actor.id,
        actor_name: actor.name,
        note_code: event.noteCode ?? null,
        note,
        meta: event.meta ?? {},
      })
      .select('*')
      .single()
    if (error) dbFailure('training_events', `Recording a ${event.eventType} event`, error)
    return mapEventRow(data as TrainingEventRow)
  }

  /** The training log, newest first, 1-based pages (default 50 a page), optionally for one person. */
  static async getActivity(opts: { page?: number; pageSize?: number; employeeId?: string } = {}): Promise<ActivityPage> {
    const client = admin()
    const pageSize = Math.min(Math.max(Math.floor(opts.pageSize ?? 50), 1), 200)
    const page = Math.max(Math.floor(opts.page ?? 1), 1)
    const from = (page - 1) * pageSize
    let query = client.from('training_events').select('*', { count: 'exact' })
    if (opts.employeeId) query = query.eq('employee_id', opts.employeeId)
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) dbFailure('training_events', 'Reading the training log', error)
    const events = ((data ?? []) as TrainingEventRow[]).map(mapEventRow)
    return { items: await TrainingService.toActivityItems(client, events), page, pageSize, total: count ?? events.length }
  }

  /** Every log line, newest first, for the CSV export (paged reads, no row cap). */
  static async listActivityForExport(opts: { employeeId?: string } = {}): Promise<ActivityItem[]> {
    const client = admin()
    const rows = await fetchAllRows<TrainingEventRow>(
      (from, to) => {
        let query = client.from('training_events').select('*')
        if (opts.employeeId) query = query.eq('employee_id', opts.employeeId)
        return query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
      },
      { label: 'training: log export', maxRows: 500_000 }
    )
    return TrainingService.toActivityItems(client, rows.map(mapEventRow))
  }

  private static async toActivityItems(client: AdminClient, events: readonly TrainingEvent[]): Promise<ActivityItem[]> {
    const employeeIds = unique(events.map((event) => event.employeeId).filter((id): id is string => Boolean(id)))
    const courseIds = new Set(events.map((event) => event.courseId).filter((id): id is string => Boolean(id)))
    const employees = employeeIds.length ? await loadEmployeesByIds(client, employeeIds) : []
    const names = new Map(employees.map((employee) => [employee.employee_id, displayName(employee)]))
    const courses = courseIds.size ? (await loadCourses(client)).filter((course) => courseIds.has(course.id)) : []
    const titles = new Map(courses.map((course) => [course.id, course.title]))
    return events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      eventType: event.eventType,
      employeeId: event.employeeId,
      employeeName: event.employeeId ? names.get(event.employeeId) ?? null : null,
      courseId: event.courseId,
      courseTitle: event.courseId ? titles.get(event.courseId) ?? null : null,
      assignmentId: event.assignmentId,
      actorName: event.actorName,
      noteCode: event.noteCode,
      note: event.note,
      meta: event.meta,
    }))
  }

  // -------------------------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------------------------

  /** Active and Started Separation staff against live courses (contract section 6). */
  static async getMatrix(opts: { today?: string } = {}): Promise<TrainingMatrix> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const employees = await loadEmployeesByStatus(client, IN_SCOPE_STATUSES)
    const courses = (await loadCourses(client, ['live'])).sort(compareCourses)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const assignments = await loadAllAssignments(client)
    const profiles = await loadProfiles(client, null)
    const rota = await loadRecentRotaDepartments(client, null, today)

    const assignmentsByEmployee = new Map<string, TrainingAssignment[]>()
    for (const assignment of assignments) {
      const list = assignmentsByEmployee.get(assignment.employeeId) ?? []
      list.push(assignment)
      assignmentsByEmployee.set(assignment.employeeId, list)
    }

    const counts = new Map(courses.map((course) => [course.id, { required: 0, completed: 0 }]))
    const named = disambiguatedNames(employees)
    const people: MatrixPerson[] = named
      .map(({ employee, name }) => {
        const person = personContext(employee, profiles.get(employee.employee_id) ?? null, rota.get(employee.employee_id) ?? [], today)
        const personAssignments = assignmentsByEmployee.get(employee.employee_id) ?? []
        const byCourse = groupByCourse(personAssignments)
        let dobMissing = false
        const cells: Record<string, MatrixCell> = {}
        for (const course of courses) {
          const cycles = byCourse.get(course.id) ?? []
          const { inAudience, applies, dobMissing: missing } = appliesForDisplay(course, person, today)
          if (missing) dobMissing = true
          // A sign-off counts only while the course it depends on is valid (spec 4.1).
          const prerequisiteValid = prerequisiteMet(prerequisiteOf(course, courseById), personAssignments, today)
          const state = matrixStateFor({ cycles, inAudience, applies, paused: person.paused, prerequisiteValid, today })
          const shown = pickDisplayAssignment(cycles)
          const completed = latestCompleted(cycles)
          const overdueDays = state === 'overdue' && shown?.dueOn ? daysOverdueOf(shown.dueOn, today) : null
          cells[course.id] = {
            courseId: course.id,
            assignmentId: shown?.id ?? null,
            state,
            dueOn: shown && isOpenStatus(shown.status) ? shown.dueOn : null,
            daysOverdue: overdueDays,
            completedOn: completed?.completedOn ?? null,
            expiresOn: completed?.expiresOn ?? null,
            supervisedOnly: (shown ?? completed)?.supervisedOnly ?? false,
          }
          const hasOpen = cycles.some((cycle) => isOpenStatus(cycle.status))
          // Paused and waived people are left out of the completion count (owner decision,
          // 3 November 2026); insights reads this same count.
          if (!person.paused && state !== 'waived' && (applies || hasOpen)) {
            const tally = counts.get(course.id)
            if (tally) {
              tally.required += 1
              if (countsAsDone({ assignments: cycles, prerequisiteValid, today })) tally.completed += 1
            }
          }
        }
        return {
          employeeId: employee.employee_id,
          name,
          status: person.status === 'Started Separation' ? 'Started Separation' : 'Active',
          jobTitle: employee.job_title,
          groups: person.groups,
          suggestedGroups: person.suggestedGroups,
          groupsConfirmed: person.groupsConfirmed,
          paused: person.paused,
          flags: personFlags(person, dobMissing),
          cells,
        } satisfies MatrixPerson
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))

    const matrixCourses: MatrixCourse[] = courses.map((course) => {
      const tally = counts.get(course.id) ?? { required: 0, completed: 0 }
      return {
        ...courseRef(course),
        kind: course.kind,
        isEssentials: course.isEssentials,
        displayOrder: course.displayOrder,
        requiredCount: tally.required,
        completedCount: tally.completed,
        completionRate: tally.required ? tally.completed / tally.required : null,
      }
    })

    return { today, courses: matrixCourses, people }
  }

  /**
   * The employee record's Training tab, or null when the employee does not exist.
   * `emailsEnabled` is read from the setting when left out (it decides the "next reminder").
   */
  static async getEmployeeTraining(
    employeeId: string,
    opts: { today?: string; emailsEnabled?: boolean } = {}
  ): Promise<EmployeeTrainingView | null> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const employee = await loadEmployee(client, employeeId)
    if (!employee) return null

    const profile = (await loadProfiles(client, [employeeId])).get(employeeId) ?? null
    const rota = await loadRecentRotaDepartments(client, [employeeId], today)
    const person = personContext(employee, profile, rota.get(employeeId) ?? [], today)
    const assignments = await loadAllAssignments(client, { employeeId })
    const courses = await loadCourses(client)
    const courseById = new Map(courses.map((course) => [course.id, course]))

    // The version each cycle was taken on, or the course's current one before the first start.
    const versionIdFor = (assignment: TrainingAssignment): string | null =>
      assignment.versionId ?? courseById.get(assignment.courseId)?.currentVersionId ?? null
    const versions = await loadVersionsWithContent(
      client,
      assignments.map(versionIdFor).filter((id): id is string => Boolean(id))
    )
    const attempts = await TrainingService.listAttemptsForEmployee(client, employeeId)
    const documentStatuses = await loadSigningStatuses(
      client,
      assignments.map((assignment) => assignment.signingDocumentId).filter((id): id is string => Boolean(id))
    )

    const emailsEnabled = opts.emailsEnabled ?? (await getTrainingEmailsEnabled(client))
    const openIds = assignments.filter((assignment) => isOpenStatus(assignment.status)).map((assignment) => assignment.id)
    const claims = openIds.length
      ? await TrainingService.listReminderClaimKeys({ assignmentIds: openIds, employeeIds: [employeeId] })
      : new Set<string>()
    const suppressed = employee.email_address ? await loadSuppressedEmails(client, [employee.email_address]) : new Set<string>()
    const reminderPerson = {
      email: employee.email_address,
      employeeStatus: person.status,
      hasLogin: Boolean(employee.auth_user_id),
      paused: person.paused,
      emailSuppressed: employee.email_address ? suppressed.has(employee.email_address.trim().toLowerCase()) : false,
    }

    let dobMissing = false
    for (const course of courses) {
      if (appliesForDisplay(course, person, today).dobMissing) dobMissing = true
    }

    const cyclesByCourse = groupByCourse(assignments)
    const items: EmployeeAssignmentItem[] = []
    for (const assignment of assignments) {
      const course = courseById.get(assignment.courseId)
      if (!course) continue
      const versionId = versionIdFor(assignment)
      const version = versionId ? versions.get(versionId) ?? null : null
      const content = version?.content ?? null
      const own = attempts.filter((attempt) => attempt.assignmentId === assignment.id)
      const open = isOpenStatus(assignment.status)
      // An open cycle is read with the course's other cycles, so one opened after a completion
      // that has since expired shows as expired (spec 4.3). A closed cycle is read on its own.
      const state = displayStateFor({
        assignments: open ? cyclesByCourse.get(assignment.courseId) ?? [assignment] : [assignment],
        applies: open,
        paused: open && person.paused,
        today,
      })
      let nextReminder: EmployeeAssignmentItem['nextReminder'] = null
      if (open && course.kind === 'online') {
        const documentStatus = assignment.signingDocumentId ? documentStatuses.get(assignment.signingDocumentId) : undefined
        nextReminder = forecastNextReminder({
          item: {
            assignmentId: assignment.id,
            courseId: course.id,
            courseTitle: course.title,
            courseKind: course.kind,
            status: assignment.status,
            assignedOn: assignment.assignedOn,
            dueOn: assignment.dueOn,
            confirmationSettled: documentStatus === 'completed' || documentStatus === 'superseded',
            progress: progressSummary(content, assignment),
          },
          person: reminderPerson,
          today,
          emailsEnabled,
          existingClaims: claims,
        })
      }
      items.push({
        assignment,
        course: { ...courseRef(course), kind: course.kind, isEssentials: course.isEssentials },
        versionLabel: assignment.versionId ? versionLabelOf(version) : null,
        state,
        nextReminder,
        sections: sectionViews(content, assignment, own),
        attempts: own.map((attempt) => attemptSummary(attempt, content)),
        certificate: assignment.signingDocumentId
          ? { documentId: assignment.signingDocumentId, status: documentStatuses.get(assignment.signingDocumentId) ?? 'sent' }
          : null,
        tasks: practicalTasksFrom(course, version),
      })
    }

    const orderOf = (item: EmployeeAssignmentItem): number => courseById.get(item.course.id)?.displayOrder ?? 100
    const current = items
      .filter((item) => isOpenStatus(item.assignment.status))
      .sort(
        (a, b) =>
          Number(b.course.isEssentials) - Number(a.course.isEssentials) ||
          orderOf(a) - orderOf(b) ||
          a.course.title.localeCompare(b.course.title, 'en-GB')
      )
    const history = items
      .filter((item) => !isOpenStatus(item.assignment.status))
      .sort((a, b) => b.assignment.createdAt.localeCompare(a.assignment.createdAt) || b.assignment.cycle - a.assignment.cycle)

    const openCourseIds = new Set(current.map((item) => item.course.id))
    const assignable = courses
      .filter((course) => course.status === 'live' && !openCourseIds.has(course.id))
      .sort(compareCourses)
      .map(courseRef)

    const age = ageOn(employee.date_of_birth, today)
    const pause =
      person.paused && profile?.pausedFrom && profile.pauseReason
        ? { from: profile.pausedFrom, until: profile.pausedUntil, reason: profile.pauseReason }
        : null

    return {
      today,
      employee: {
        employeeId,
        name: displayName(employee),
        status: person.status,
        jobTitle: employee.job_title,
        startDate: employee.employment_start_date,
        hasLogin: Boolean(employee.auth_user_id),
        dateOfBirthKnown: Boolean(employee.date_of_birth),
        under18: age === null ? null : age < 18,
      },
      profile,
      suggestedGroups: person.suggestedGroups,
      groups: person.groups,
      groupsConfirmed: person.groupsConfirmed,
      pause,
      flags: personFlags(person, dobMissing),
      current,
      history,
      assignable,
    }
  }

  /** My Training for the signed-in worker (the caller passes the portal identity's employee id). */
  static async getMyTraining(employeeId: string, opts: { today?: string } = {}): Promise<MyTrainingView> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const assignments = await loadAllAssignments(client, { employeeId })
    if (assignments.length === 0) return { today, due: [], waiting: [], done: [] }

    const profile = (await loadProfiles(client, [employeeId])).get(employeeId) ?? null
    const paused = isPausedOn(profile, today)
    const courses = await loadCourses(client)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const versionIdFor = (assignment: TrainingAssignment): string | null =>
      assignment.versionId ?? courseById.get(assignment.courseId)?.currentVersionId ?? null
    const versions = await loadVersionsWithContent(
      client,
      assignments.map(versionIdFor).filter((id): id is string => Boolean(id))
    )
    const completedDocuments = assignments
      .filter((assignment) => assignment.status === 'completed' && assignment.signingDocumentId)
      .map((assignment) => assignment.signingDocumentId as string)
    const parties = completedDocuments.length ? await loadWorkerParties(client, completedDocuments, employeeId) : new Map<string, string>()

    const byCourse = groupByCourse(assignments)
    const due: MyTrainingItem[] = []
    const waiting: MyTrainingItem[] = []
    const done: MyTrainingItem[] = []

    for (const [courseId, cycles] of byCourse) {
      const course = courseById.get(courseId)
      if (!course) continue
      // A lapsed prerequisite turns a sign-off with no open cycle into `waiting` (spec 4.1); it
      // still lists under Done, with the waiting badge ("Waiting for another course").
      const state = displayStateFor({
        assignments: cycles,
        applies: true,
        paused,
        prerequisiteValid: prerequisiteMet(prerequisiteOf(course, courseById), assignments, today),
        today,
      })
      const item = (assignment: TrainingAssignment, overrides: Partial<MyTrainingItem>): MyTrainingItem => {
        const versionId = versionIdFor(assignment)
        const content = versionId ? versions.get(versionId)?.content ?? null : null
        const summary = progressSummary(content, assignment)
        return {
          assignmentId: assignment.id,
          course: {
            ...courseRef(course),
            kind: course.kind,
            isEssentials: course.isEssentials,
            summary: course.summary ?? content?.summary ?? null,
            estimatedMinutes: content?.estimatedMinutes ?? null,
          },
          state,
          dueOn: assignment.dueOn,
          completedOn: assignment.completedOn,
          expiresOn: assignment.expiresOn,
          sectionsPassed: summary.sectionsPassed,
          sectionsTotal: summary.sectionsTotal,
          action: 'none',
          waitingReason: null,
          supervisedOnly: assignment.supervisedOnly,
          certificatePartyId: null,
          ...overrides,
        }
      }

      const open = cycles.find((cycle) => isOpenStatus(cycle.status))
      if (open) {
        let reason: MyTrainingWaitingReason | null = null
        if (paused) reason = 'paused'
        else if (open.status === 'waiting') reason = 'prerequisite'
        else if (open.status === 'locked') reason = 'locked'
        else if (open.status === 'declined') reason = 'declined'
        else if (course.kind !== 'online') reason = 'practical'

        if (reason) {
          waiting.push(item(open, { waitingReason: reason }))
        } else if (open.status === 'awaiting_confirmation') {
          due.push(item(open, { action: 'confirm' }))
        } else {
          due.push(item(open, { action: open.status === 'in_progress' || open.startedAt ? 'continue' : 'start' }))
        }
      }

      const completed = latestCompleted(cycles)
      if (completed) {
        const partyId = completed.signingDocumentId ? parties.get(completed.signingDocumentId) ?? null : null
        done.push(item(completed, { dueOn: null, certificatePartyId: partyId, state: open ? 'done' : state }))
      }
    }

    const orderOf = (item: MyTrainingItem): number => courseById.get(item.course.id)?.displayOrder ?? 100
    due.sort(
      (a, b) =>
        Number(b.course.isEssentials) - Number(a.course.isEssentials) ||
        (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') ||
        orderOf(a) - orderOf(b)
    )
    waiting.sort((a, b) => orderOf(a) - orderOf(b) || a.course.title.localeCompare(b.course.title, 'en-GB'))
    done.sort((a, b) => (b.completedOn ?? '').localeCompare(a.completedOn ?? ''))
    return { today, due, waiting, done }
  }

  /**
   * One of the worker's own cycles in the player, or null when it is not theirs, not online or
   * practical, or closed. Cards and objectives only, never questions or answers. A practical
   * course comes back so its notes can be read; it has no sections, and its sign-off is
   * confirmed in person, so its confirmation is only ever `declined` or `not_ready`.
   */
  static async getMyAssignment(employeeId: string, assignmentId: string, opts: { today?: string } = {}): Promise<MyAssignmentView | null> {
    const client = admin()
    const today = opts.today ?? trainingToday()
    const assignment = await TrainingService.getAssignment(assignmentId)
    if (!assignment || assignment.employeeId !== employeeId || !isOpenStatus(assignment.status)) return null
    const course = await TrainingService.getCourseById(assignment.courseId)
    if (!course || (course.kind !== 'online' && course.kind !== 'practical')) return null
    const versionId = assignment.versionId ?? course.currentVersionId
    if (!versionId) return null
    const version = await TrainingService.getPublishedVersion(versionId)
    if (!version || version.content.kind !== course.kind) return null

    const profile = await TrainingService.getProfile(employeeId)
    const paused = isPausedOn(profile, today)
    const sectionKeys = version.content.sections.map((section) => section.key)

    let confirmation: MyAssignmentView['confirmation'] = { state: 'not_ready', confirmUrl: null }
    if (assignment.status === 'declined') {
      confirmation = { state: 'declined', confirmUrl: null }
    } else if (assignment.status === 'awaiting_confirmation' && course.kind === 'online') {
      // Online only: a practical sign-off is confirmed in person beside the manager, never from
      // the player, so it needs no signing lookup.
      confirmation = { state: 'retry', confirmUrl: null }
      if (assignment.signingDocumentId) {
        const status = (await loadSigningStatuses(client, [assignment.signingDocumentId])).get(assignment.signingDocumentId)
        if (status === 'completed') {
          confirmation = { state: 'done', confirmUrl: null }
        } else if (status && SIGNING_OPEN_STATUSES.includes(status)) {
          const partyId = (await loadWorkerParties(client, [assignment.signingDocumentId], employeeId)).get(assignment.signingDocumentId)
          if (partyId) confirmation = { state: 'ready', confirmUrl: `/portal/documents/${partyId}` }
        }
      }
    }

    return {
      assignmentId: assignment.id,
      courseId: course.id,
      status: assignment.status,
      state: displayStateFor({ assignments: [assignment], applies: true, paused, today }),
      dueOn: assignment.dueOn,
      course: playerCourseFrom(version),
      progress: assignment.progress,
      sectionStates: sectionStatesFor(assignment.progress, sectionKeys, assignment.lockedSection),
      lockedSection: assignment.lockedSection,
      confirmation,
    }
  }

  /**
   * A version (draft or published) ready for the preview player, or null. A practical course's
   * version previews its notes (it has no sections).
   */
  static async getPlayerCourse(versionId: string): Promise<PlayerCourseView | null> {
    const version = await TrainingService.getVersion(versionId)
    if (!version) return null
    return playerCourseFrom(version)
  }

  /**
   * Check time per person between two London dates, with the minutes outside clocked or rostered
   * shifts. An attempt counts from its start to its submit, as the server recorded them; a
   * clock-in still open counts as running until now.
   */
  static async getPayReport(range: { from: string; to: string }): Promise<PayReport> {
    const { from, to } = range
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
      throw new TrainingError('invalid', 'Choose a start date on or before the end date.')
    }
    const client = admin()
    const startMs = whenLondonClockReaches(from, '00:00')?.getTime()
    const endMs = whenLondonClockReaches(addDaysOrThrow(to, 1), '00:00')?.getTime()
    if (startMs === undefined || endMs === undefined) throw new TrainingError('invalid', 'Those dates could not be read.')

    const attempts = (
      await fetchAllRows<TrainingAttemptRow>(
        (rangeFrom, rangeTo) =>
          client
            .from('training_attempts')
            .select('*')
            .gte('started_at', new Date(startMs).toISOString())
            .lt('started_at', new Date(endMs).toISOString())
            .not('submitted_at', 'is', null)
            .order('started_at', { ascending: true })
            .order('id', { ascending: true })
            .range(rangeFrom, rangeTo),
        { label: 'training: pay report attempts' }
      )
    ).map(mapAttemptRow)
    if (attempts.length === 0) return { from, to, rows: [] }

    const employeeIds = unique(attempts.map((attempt) => attempt.employeeId))
    const employees = await loadEmployeesByIds(client, employeeIds)
    const names = new Map(employees.map((employee) => [employee.employee_id, displayName(employee)]))
    const assignmentIds = unique(attempts.map((attempt) => attempt.assignmentId))
    const assignments = new Map<string, TrainingAssignment>()
    for (const chunk of chunked(assignmentIds)) {
      const { data, error } = await client.from('training_assignments').select('*').in('id', chunk)
      if (error) dbFailure('training_assignments', 'Reading cycles for the pay report', error)
      for (const row of (data ?? []) as TrainingAssignmentRow[]) assignments.set(row.id, mapAssignmentRow(row))
    }
    const courses = new Map((await loadCourses(client)).map((course) => [course.id, course]))
    const versions = await loadVersionsWithContent(client, unique(attempts.map((attempt) => attempt.versionId)))

    // Shift windows: clocked sessions and rostered (scheduled) shifts, a day either side.
    const windows = new Map<string, Array<[number, number]>>()
    const addWindow = (employeeId: string, start: number, end: number): void => {
      const list = windows.get(employeeId) ?? []
      list.push([start, end])
      windows.set(employeeId, list)
    }
    const dayBefore = addDaysOrThrow(from, -1)
    const dayAfter = addDaysOrThrow(to, 1)
    const now = Date.now()
    for (const chunk of chunked(employeeIds)) {
      const sessions = await fetchAllRows<{ employee_id: string; clock_in_at: string; clock_out_at: string | null }>(
        (rangeFrom, rangeTo) =>
          client
            .from('timeclock_sessions')
            .select('employee_id, clock_in_at, clock_out_at')
            .in('employee_id', chunk)
            .gte('work_date', dayBefore)
            .lte('work_date', dayAfter)
            .order('id', { ascending: true })
            .range(rangeFrom, rangeTo),
        { label: 'training: pay report clock sessions' }
      )
      for (const session of sessions) {
        const start = Date.parse(session.clock_in_at)
        const end = session.clock_out_at ? Date.parse(session.clock_out_at) : now
        if (Number.isFinite(start) && Number.isFinite(end)) addWindow(session.employee_id, start, end)
      }

      const shifts = await fetchAllRows<{
        employee_id: string | null
        shift_date: string
        start_time: string
        end_time: string
        is_overnight: boolean
      }>(
        (rangeFrom, rangeTo) =>
          client
            .from('rota_published_shifts')
            .select('employee_id, shift_date, start_time, end_time, is_overnight')
            .in('employee_id', chunk)
            .gte('shift_date', dayBefore)
            .lte('shift_date', to)
            .eq('status', ROSTERED_STATUS)
            .order('id', { ascending: true })
            .range(rangeFrom, rangeTo),
        { label: 'training: pay report rota shifts' }
      )
      for (const shift of shifts) {
        if (!shift.employee_id) continue
        const start = whenLondonClockReaches(shift.shift_date, shift.start_time)
        const crossesMidnight = shift.is_overnight || shift.end_time <= shift.start_time
        const endDate = crossesMidnight ? shiftIsoDate(shift.shift_date, 1) : shift.shift_date
        const end = endDate ? whenLondonClockReaches(endDate, shift.end_time) : null
        if (start && end) addWindow(shift.employee_id, start.getTime(), end.getTime())
      }
    }

    const rows = new Map<string, PayReportRow>()
    for (const attempt of attempts) {
      if (!attempt.submittedAt) continue
      const assignment = assignments.get(attempt.assignmentId)
      const course = assignment ? courses.get(assignment.courseId) : undefined
      const content = versions.get(attempt.versionId)?.content ?? null
      const startMs = Date.parse(attempt.startedAt)
      const endMs = Math.max(startMs, Date.parse(attempt.submittedAt))
      const minutes = Math.round((endMs - startMs) / 60_000)
      const outside = Math.min(
        minutes,
        Math.round(msOutside(startMs, endMs, mergeWindows(windows.get(attempt.employeeId) ?? [])) / 60_000)
      )
      const entry: PayReportEntry = {
        attemptId: attempt.id,
        date: londonDateOf(attempt.startedAt),
        courseTitle: course?.title ?? content?.title ?? 'Training',
        sectionTitle: sectionTitleOf(content, attempt.sectionKey),
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        minutes,
        minutesOutsideShifts: outside,
      }
      const row = rows.get(attempt.employeeId) ?? {
        employeeId: attempt.employeeId,
        name: names.get(attempt.employeeId) ?? 'Unknown',
        minutesTotal: 0,
        minutesOutsideShifts: 0,
        entries: [],
      }
      row.entries.push(entry)
      row.minutesTotal += entry.minutes
      row.minutesOutsideShifts += entry.minutesOutsideShifts
      rows.set(attempt.employeeId, row)
    }

    return { from, to, rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB')) }
  }

  // -------------------------------------------------------------------------------------------
  // Courses
  // -------------------------------------------------------------------------------------------

  /** Every course, by display order then title. Retired courses are left out unless asked for. */
  static async listCourses(opts: { includeRetired?: boolean } = {}): Promise<TrainingCourse[]> {
    return loadCourses(admin(), opts.includeRetired ? undefined : ['draft', 'live'])
  }

  /** Live courses, by display order then title. */
  static async listLiveCourses(): Promise<TrainingCourse[]> {
    return loadCourses(admin(), ['live'])
  }

  /** The Courses list with versions and counts. */
  static async listCourseItems(): Promise<CourseListItem[]> {
    const client = admin()
    const today = trainingToday()
    const courses = await loadCourses(client)
    if (courses.length === 0) return []
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const metas = await TrainingService.listVersionMetas(client, courses.map((course) => course.id))
    const assignments = await loadAllAssignments(client)

    return courses.map((course) => {
      const own = metas.filter((meta) => meta.courseId === course.id)
      const current = own.find((meta) => meta.id === course.currentVersionId && meta.state === 'published') ?? null
      const draft = own.find((meta) => meta.state === 'draft') ?? null
      const cycles = assignments.filter((assignment) => assignment.courseId === course.id)
      const holders = new Set(
        cycles
          .filter((cycle) => cycle.status === 'completed' && (cycle.expiresOn === null || cycle.expiresOn >= today))
          .map((cycle) => cycle.employeeId)
      )
      const prerequisite = course.prerequisiteCourseId ? courseById.get(course.prerequisiteCourseId) ?? null : null
      return {
        ...courseRef(course),
        kind: course.kind,
        status: course.status,
        isEssentials: course.isEssentials,
        audienceGroups: course.audienceGroups,
        audienceAge: course.audienceAge,
        refresherMonths: course.refresherMonths,
        displayOrder: course.displayOrder,
        prerequisite: prerequisite ? courseRef(prerequisite) : null,
        currentVersion: current ? versionRefOf(current) : null,
        hasDraft: draft !== null,
        draftUploadedAt: draft?.uploadedAt ?? null,
        assignedCount: cycles.filter((cycle) => isOpenStatus(cycle.status)).length,
        completedCount: holders.size,
      }
    })
  }

  static async getCourseBySlug(slug: string): Promise<TrainingCourse | null> {
    const { data, error } = await admin().from('training_courses').select('*').eq('slug', slug).maybeSingle()
    if (error) dbFailure('training_courses', 'Reading a course', error)
    return data ? mapCourseRow(data as TrainingCourseRow) : null
  }

  static async getCourseById(courseId: string): Promise<TrainingCourse | null> {
    const { data, error } = await admin().from('training_courses').select('*').eq('id', courseId).maybeSingle()
    if (error) dbFailure('training_courses', 'Reading a course', error)
    return data ? mapCourseRow(data as TrainingCourseRow) : null
  }

  /** A course page: versions, the draft re-checked in publish mode, and counts. */
  static async getCourseDetail(slug: string): Promise<CourseDetailView | null> {
    const client = admin()
    const today = trainingToday()
    const course = await TrainingService.getCourseBySlug(slug)
    if (!course) return null
    const prerequisite = course.prerequisiteCourseId ? await TrainingService.getCourseById(course.prerequisiteCourseId) : null
    const metas = await TrainingService.listVersions(course.id)
    const published = metas.filter((meta) => meta.state === 'published')
    const current = published.find((meta) => meta.id === course.currentVersionId) ?? null

    let draft: CourseDetailView['draft'] = null
    const draftVersion = await TrainingService.getDraftVersion(course.id)
    if (draftVersion) {
      const { content, ...meta } = draftVersion
      const check = validateCourse(content, { mode: 'publish', availableImages: draftVersion.images.map((image) => image.src) })
      draft = { version: meta, errors: check.errors, warnings: check.warnings, gaps: check.gaps, publishable: check.ok }
    }

    const cycles = await loadAllAssignments(client, { courseId: course.id })
    return { course, prerequisite: prerequisite ? courseRef(prerequisite) : null, current, versions: published, draft, stats: courseStats(cycles, today) }
  }

  /** Creates a course row. A slug already taken is a TrainingError 'conflict'. */
  static async createCourse(input: NewTrainingCourse): Promise<TrainingCourse> {
    const { data, error } = await admin()
      .from('training_courses')
      .insert({
        slug: input.slug,
        title: input.title,
        kind: input.kind,
        audience_groups: input.audienceGroups,
        audience_age: input.audienceAge,
        is_essentials: input.isEssentials,
        prerequisite_course_id: input.prerequisiteCourseId,
        new_starter_due_days: input.newStarterDueDays,
        existing_staff_due_days: input.existingStaffDueDays,
        refresher_months: input.refresherMonths,
        window_days: input.windowDays,
        supervised_only_under_18: input.supervisedOnlyUnder18,
        display_order: input.displayOrder ?? 100,
        status: input.status ?? 'draft',
        summary: input.summary,
        created_by: input.actor.id,
        created_by_name: input.actor.name,
      })
      .select('*')
      .single()
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', `A course with the short name "${input.slug}" already exists.`)
    }
    if (error) dbFailure('training_courses', 'Creating a course', error)
    return mapCourseRow(data as TrainingCourseRow)
  }

  static async updateCourse(courseId: string, patch: TrainingCoursePatch): Promise<TrainingCourse> {
    const row = patchToRow(patch, COURSE_PATCH_COLUMNS, 'training_courses')
    if (Object.keys(row).length === 0) {
      const course = await TrainingService.getCourseById(courseId)
      if (!course) throw new TrainingError('not_found', 'That course could not be found.')
      return course
    }
    const { data, error } = await admin().from('training_courses').update(row).eq('id', courseId).select('*')
    if (error) dbFailure('training_courses', 'Updating a course', error)
    const updated = ((data ?? []) as TrainingCourseRow[])[0]
    if (!updated) throw new TrainingError('not_found', 'That course could not be found.')
    return mapCourseRow(updated)
  }

  // -------------------------------------------------------------------------------------------
  // Versions
  // -------------------------------------------------------------------------------------------

  /** A version, draft or published, with its content. */
  static async getVersion(versionId: string): Promise<TrainingCourseVersion | null> {
    const { data, error } = await admin().from('training_course_versions').select('*').eq('id', versionId).maybeSingle()
    if (error) dbFailure('training_course_versions', 'Reading a course version', error)
    return data ? mapCourseVersionRow(data as TrainingCourseVersionRow) : null
  }

  /** A published version with its content, or null when it is missing or still a draft. */
  static async getPublishedVersion(versionId: string): Promise<TrainingCourseVersion | null> {
    const { data, error } = await admin()
      .from('training_course_versions')
      .select('*')
      .eq('id', versionId)
      .eq('state', 'published')
      .maybeSingle()
    if (error) dbFailure('training_course_versions', 'Reading a published version', error)
    return data ? mapCourseVersionRow(data as TrainingCourseVersionRow) : null
  }

  /** The course's current published version (`current_version_id`), or null. */
  static async getCurrentVersion(courseId: string): Promise<TrainingCourseVersion | null> {
    const course = await TrainingService.getCourseById(courseId)
    if (!course?.currentVersionId) return null
    return TrainingService.getPublishedVersion(course.currentVersionId)
  }

  /** The course's draft (at most one), or null. */
  static async getDraftVersion(courseId: string): Promise<TrainingCourseVersion | null> {
    const { data, error } = await admin()
      .from('training_course_versions')
      .select('*')
      .eq('course_id', courseId)
      .eq('state', 'draft')
      .maybeSingle()
    if (error) dbFailure('training_course_versions', 'Reading the draft', error)
    return data ? mapCourseVersionRow(data as TrainingCourseVersionRow) : null
  }

  /** Every version of a course without content, newest first (the draft first when there is one). */
  static async listVersions(courseId: string): Promise<TrainingCourseVersionMeta[]> {
    return TrainingService.listVersionMetas(admin(), [courseId])
  }

  private static async listVersionMetas(client: AdminClient, courseIds: readonly string[]): Promise<TrainingCourseVersionMeta[]> {
    const metas: TrainingCourseVersionMeta[] = []
    for (const chunk of chunked(unique(courseIds))) {
      const { data, error } = await client.from('training_course_versions').select(VERSION_META_COLUMNS).in('course_id', chunk)
      if (error) dbFailure('training_course_versions', 'Listing course versions', error)
      metas.push(...((data ?? []) as Array<Omit<TrainingCourseVersionRow, 'content'>>).map(mapCourseVersionMetaRow))
    }
    return metas.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'draft' ? -1 : 1
      return (b.major ?? 0) - (a.major ?? 0) || (b.minor ?? 0) - (a.minor ?? 0) || b.uploadedAt.localeCompare(a.uploadedAt)
    })
  }

  /** Saves the course's draft, replacing the one there (published versions are never touched). */
  static async saveDraftVersion(input: SaveDraftVersionInput): Promise<TrainingCourseVersion> {
    const client = admin()
    const fields = {
      content: input.content,
      content_sha256: input.contentSha256,
      images: input.images,
      uploaded_by: input.actor.id,
      uploaded_by_name: input.actor.name,
      uploaded_at: nowIso(),
    }
    const existing = await TrainingService.getDraftVersion(input.courseId)
    if (existing) {
      const { data, error } = await client
        .from('training_course_versions')
        .update(fields)
        .eq('id', existing.id)
        .eq('state', 'draft')
        .select('*')
      if (error) dbFailure('training_course_versions', 'Replacing the draft', error)
      const row = ((data ?? []) as TrainingCourseVersionRow[])[0]
      if (!row) throw new TrainingError('conflict', 'The draft was published or replaced while you were uploading. Upload it again.')
      return mapCourseVersionRow(row)
    }
    const { data, error } = await client
      .from('training_course_versions')
      .insert({ course_id: input.courseId, state: 'draft', ...fields })
      .select('*')
      .single()
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', 'Someone else uploaded a draft of this course at the same moment. Upload it again.')
    }
    if (error) dbFailure('training_course_versions', 'Saving the draft', error)
    return mapCourseVersionRow(data as TrainingCourseVersionRow)
  }

  /**
   * Freezes the draft as `major.minor` (content, fingerprint and images unchanged, as the trigger
   * requires). Only the draft that was checked is frozen: the write also matches the
   * `uploaded_at` the caller read, which every upload resets, so a draft replaced in between (new
   * content or new images) is refused as a conflict rather than published unchecked.
   *
   * The course row is left alone. Pointing `current_version_id` at the new version, with the
   * course details from its content, is the publish action's next step (one course update), so a
   * publish that stops after this point is seen as unfinished and can be finished by pressing
   * Publish again.
   */
  static async publishDraftVersion(input: PublishDraftVersionInput): Promise<TrainingCourseVersion> {
    const { data, error } = await admin()
      .from('training_course_versions')
      .update({
        state: 'published',
        major: input.major,
        minor: input.minor,
        change_note: input.changeNote,
        redo_required: input.redoRequired,
        published_by: input.actor.id,
        published_by_name: input.actor.name,
        published_at: nowIso(),
      })
      .eq('id', input.draftVersionId)
      .eq('course_id', input.courseId)
      .eq('state', 'draft')
      .eq('uploaded_at', input.expectedUploadedAt)
      .select('*')
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', `Version ${input.major}.${input.minor} of this course already exists. Refresh and try again.`)
    }
    if (error) dbFailure('training_course_versions', 'Publishing the draft', error)
    const row = ((data ?? []) as TrainingCourseVersionRow[])[0]
    if (!row) throw new TrainingError('conflict', 'The draft was replaced or published while you were looking at it. Refresh and try again.')
    return mapCourseVersionRow(row)
  }

  /** Whether the `course_published` event for this version has been written (an unfinished publish has none). */
  static async hasCoursePublishedEvent(courseId: string, versionId: string): Promise<boolean> {
    const client = admin()
    const rows = await fetchAllRows<{ id: string; meta: unknown }>(
      (from, to) =>
        client
          .from('training_events')
          .select('id, meta')
          .eq('event_type', 'course_published')
          .eq('course_id', courseId)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'training: publish events' }
    )
    return rows.some((row) => {
      const meta = row.meta
      return typeof meta === 'object' && meta !== null && (meta as { versionId?: unknown }).versionId === versionId
    })
  }

  /** Whether a portal worker has any cycle on the course a version belongs to (the image route). */
  static async employeeCanSeeVersion(employeeId: string, versionId: string): Promise<boolean> {
    const client = admin()
    const { data: version, error } = await client
      .from('training_course_versions')
      .select('course_id')
      .eq('id', versionId)
      .eq('state', 'published')
      .maybeSingle()
    if (error) dbFailure('training_course_versions', 'Reading a version for an image', error)
    if (!version) return false
    const { data, error: assignmentError } = await client
      .from('training_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('course_id', (version as { course_id: string }).course_id)
      .limit(1)
    if (assignmentError) dbFailure('training_assignments', 'Checking a cycle for an image', assignmentError)
    return ((data ?? []) as unknown[]).length > 0
  }

  // -------------------------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------------------------

  /** The people asked for, in any status; ids with no employee are left out. */
  static async getTrainingPeople(employeeIds: readonly string[]): Promise<TrainingPerson[]> {
    const employees = await loadEmployeesByIds(admin(), employeeIds)
    return employees.map((employee) => ({
      employeeId: employee.employee_id,
      name: displayName(employee),
      status: asEmployeeStatus(employee.status),
      employmentStartDate: employee.employment_start_date,
      dateOfBirth: employee.date_of_birth,
    }))
  }

  // -------------------------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------------------------

  static async getProfile(employeeId: string): Promise<TrainingProfile | null> {
    const { data, error } = await admin().from('training_profiles').select('*').eq('employee_id', employeeId).maybeSingle()
    if (error) dbFailure('training_profiles', 'Reading a training profile', error)
    return data ? mapProfileRow(data as TrainingProfileRow) : null
  }

  /** Creates the profile on first write; changes only the fields given. */
  static async upsertProfile(employeeId: string, patch: TrainingProfilePatch): Promise<TrainingProfile> {
    const row = patchToRow(patch, PROFILE_PATCH_COLUMNS, 'training_profiles')
    // A merge upsert: on insert the other columns take their defaults; on conflict only the
    // columns given are written.
    const { error } = await admin()
      .from('training_profiles')
      .upsert({ employee_id: employeeId, ...row }, { onConflict: 'employee_id' })
    if (error) dbFailure('training_profiles', 'Saving a training profile', error)
    const saved = await TrainingService.getProfile(employeeId)
    if (!saved) throw new Error('[training_profiles] The training profile was saved but could not be read back')
    return saved
  }

  // -------------------------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------------------------

  static async getAssignment(assignmentId: string): Promise<TrainingAssignment | null> {
    const { data, error } = await admin().from('training_assignments').select('*').eq('id', assignmentId).maybeSingle()
    if (error) dbFailure('training_assignments', 'Reading a cycle', error)
    return data ? mapAssignmentRow(data as TrainingAssignmentRow) : null
  }

  /** Every cycle of one person, newest first. */
  static async listAssignmentsForEmployee(employeeId: string): Promise<TrainingAssignment[]> {
    const assignments = await loadAllAssignments(admin(), { employeeId })
    return assignments.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.cycle - a.cycle)
  }

  /** The assignment a training signing document belongs to (completion hooks). */
  static async findAssignmentBySigningDocument(documentId: string): Promise<TrainingAssignment | null> {
    const { data, error } = await admin().from('training_assignments').select('*').eq('signing_document_id', documentId).limit(1)
    if (error) dbFailure('training_assignments', 'Finding the cycle for a signing document', error)
    const row = ((data ?? []) as TrainingAssignmentRow[])[0]
    return row ? mapAssignmentRow(row) : null
  }

  /**
   * A training item's signing document status as it stands now: one still open past its link
   * expiry reads as `expired`. Null when there is no such document.
   */
  static async getSigningDocumentStatus(documentId: string): Promise<SigningDocumentStatus | null> {
    return (await loadSigningStatuses(admin(), [documentId])).get(documentId) ?? null
  }

  /** Inserts a cycle. A second open cycle for the same person and course is a TrainingError 'conflict'. */
  static async createAssignment(input: NewTrainingAssignment): Promise<TrainingAssignment> {
    const extra = input.extra ? assignmentPatchToRow(input.extra) : {}
    const { data, error } = await admin()
      .from('training_assignments')
      .insert({
        progress: emptyProgress(),
        ...extra,
        employee_id: input.employeeId,
        course_id: input.courseId,
        cycle: input.cycle,
        reason: input.reason,
        status: input.status,
        assigned_on: input.assignedOn,
        due_on: input.dueOn,
      })
      .select('*')
      .single()
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', 'This person already has this training open.')
    }
    if (error) dbFailure('training_assignments', 'Creating a cycle', error)
    return mapAssignmentRow(data as TrainingAssignmentRow)
  }

  /**
   * Changes the fields in `patch`. With a guard, the write lands only while the row still holds
   * an expected status (and `updated_at`); otherwise a TrainingError 'conflict', so two tabs or a
   * tab and the daily job cannot both move one cycle.
   */
  static async updateAssignment(
    assignmentId: string,
    patch: TrainingAssignmentPatch,
    guard?: AssignmentUpdateGuard
  ): Promise<TrainingAssignment> {
    const row = assignmentPatchToRow(patch)
    if (Object.keys(row).length === 0) {
      const current = await TrainingService.getAssignment(assignmentId)
      if (!current) throw new TrainingError('not_found', 'That training item could not be found.')
      return current
    }
    let query = admin().from('training_assignments').update(row).eq('id', assignmentId)
    if (guard?.expectedStatuses?.length) query = query.in('status', [...guard.expectedStatuses])
    if (guard?.expectedUpdatedAt) query = query.eq('updated_at', guard.expectedUpdatedAt)
    const { data, error } = await query.select('*')
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', 'That change clashes with another training item. Refresh and try again.')
    }
    if (error) dbFailure('training_assignments', 'Updating a cycle', error)
    const updated = ((data ?? []) as TrainingAssignmentRow[])[0]
    if (updated) return mapAssignmentRow(updated)
    const exists = await TrainingService.getAssignment(assignmentId)
    if (!exists) throw new TrainingError('not_found', 'That training item could not be found.')
    throw new TrainingError('conflict', 'This training item changed while you were looking at it. Refresh and try again.')
  }

  /** Online cycles in `awaiting_confirmation` with no signing document yet (certificate retry). */
  static async listCertificateRetries(): Promise<TrainingAssignment[]> {
    const client = admin()
    const rows = await fetchAllRows<TrainingAssignmentRow>(
      (from, to) =>
        client
          .from('training_assignments')
          .select('*')
          .eq('status', 'awaiting_confirmation')
          .is('signing_document_id', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'training: certificate retries' }
    )
    if (rows.length === 0) return []
    const online = new Set((await loadCourses(client)).filter((course) => course.kind === 'online').map((course) => course.id))
    return rows.map(mapAssignmentRow).filter((assignment) => online.has(assignment.courseId))
  }

  /** Cycles in `awaiting_confirmation` whose signing document has completed or been declined (finalise stage). */
  static async listConfirmationsToFinalise(): Promise<ConfirmationToFinalise[]> {
    const client = admin()
    const rows = await fetchAllRows<TrainingAssignmentRow>(
      (from, to) =>
        client
          .from('training_assignments')
          .select('*')
          .eq('status', 'awaiting_confirmation')
          .not('signing_document_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'training: confirmations to finalise' }
    )
    if (rows.length === 0) return []
    const assignments = rows.map(mapAssignmentRow)
    const statuses = await loadSigningStatuses(client, assignments.map((assignment) => assignment.signingDocumentId as string))
    const settled: ConfirmationToFinalise[] = []
    for (const assignment of assignments) {
      const documentStatus = statuses.get(assignment.signingDocumentId as string)
      if (documentStatus === 'completed' || documentStatus === 'declined') settled.push({ assignment, documentStatus })
    }
    return settled
  }

  // -------------------------------------------------------------------------------------------
  // Attempts
  // -------------------------------------------------------------------------------------------

  static async getAttempt(attemptId: string): Promise<TrainingAttempt | null> {
    const { data, error } = await admin().from('training_attempts').select('*').eq('id', attemptId).maybeSingle()
    if (error) dbFailure('training_attempts', 'Reading an attempt', error)
    return data ? mapAttemptRow(data as TrainingAttemptRow) : null
  }

  /** The unsubmitted attempt for a section (at most one), returned again by `startTrainingCheck`. */
  static async getOpenAttempt(assignmentId: string, sectionKey: string): Promise<TrainingAttempt | null> {
    const { data, error } = await admin()
      .from('training_attempts')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('section_key', sectionKey)
      .is('submitted_at', null)
      .maybeSingle()
    if (error) dbFailure('training_attempts', 'Reading the open attempt', error)
    return data ? mapAttemptRow(data as TrainingAttemptRow) : null
  }

  /** Every attempt of a cycle, oldest first. */
  static async listAttempts(assignmentId: string): Promise<TrainingAttempt[]> {
    const client = admin()
    const rows = await fetchAllRows<TrainingAttemptRow>(
      (from, to) =>
        client
          .from('training_attempts')
          .select('*')
          .eq('assignment_id', assignmentId)
          .order('started_at', { ascending: true })
          .order('attempt_no', { ascending: true })
          .range(from, to),
      { label: 'training: attempts' }
    )
    return rows.map(mapAttemptRow)
  }

  private static async listAttemptsForEmployee(client: AdminClient, employeeId: string): Promise<TrainingAttempt[]> {
    const rows = await fetchAllRows<TrainingAttemptRow>(
      (from, to) =>
        client
          .from('training_attempts')
          .select('*')
          .eq('employee_id', employeeId)
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'training: attempts for a person' }
    )
    return rows.map(mapAttemptRow)
  }

  /** Inserts an attempt. A second open attempt for the section is a TrainingError 'conflict'. */
  static async createAttempt(input: NewTrainingAttempt): Promise<TrainingAttempt> {
    const { data, error } = await admin()
      .from('training_attempts')
      .insert({
        assignment_id: input.assignmentId,
        employee_id: input.employeeId,
        version_id: input.versionId,
        section_key: input.sectionKey,
        attempt_no: input.attemptNo,
        served: input.served,
      })
      .select('*')
      .single()
    if (error && isUniqueViolation(error)) {
      throw new TrainingError('conflict', 'A check for this section is already open. Reload the page to carry on with it.')
    }
    if (error) dbFailure('training_attempts', 'Starting a check', error)
    return mapAttemptRow(data as TrainingAttemptRow)
  }

  /** Records the marking, only while `submitted_at` is null; a second submit is a TrainingError 'conflict'. */
  static async submitAttempt(attemptId: string, input: SubmitTrainingAttemptInput): Promise<TrainingAttempt> {
    const { data, error } = await admin()
      .from('training_attempts')
      .update({
        submitted_at: input.submittedAt,
        answers: input.answers,
        results: input.results,
        wrong_count: input.wrongCount,
        critical_missed: input.criticalMissed,
        passed: input.passed,
      })
      .eq('id', attemptId)
      .is('submitted_at', null)
      .select('*')
    if (error) dbFailure('training_attempts', 'Recording a check', error)
    const row = ((data ?? []) as TrainingAttemptRow[])[0]
    if (row) return mapAttemptRow(row)
    const exists = await TrainingService.getAttempt(attemptId)
    if (!exists) throw new TrainingError('not_found', 'That check could not be found.')
    throw new TrainingError('conflict', 'This check was already submitted.')
  }

  // -------------------------------------------------------------------------------------------
  // Reminder ledger (daily job)
  // -------------------------------------------------------------------------------------------

  /** Everyone the staff ladder might chase today, with their chaseable items. */
  static async getStaffReminderPeople(today: string): Promise<StaffReminderPerson[]> {
    const client = admin()
    const courses = await loadCourses(client)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const open = (await loadOpenAssignments(client)).filter((assignment) => courseById.get(assignment.courseId)?.kind === 'online')
    if (open.length === 0) return []

    const employees = await loadEmployeesByIds(client, open.map((assignment) => assignment.employeeId))
    const inScope = employees.filter((employee) => IN_SCOPE_STATUSES.includes(employee.status))
    if (inScope.length === 0) return []
    const profiles = await loadProfiles(client, inScope.map((employee) => employee.employee_id))
    const suppressed = await loadSuppressedEmails(
      client,
      inScope.map((employee) => employee.email_address).filter((email): email is string => Boolean(email))
    )
    const versionIdFor = (assignment: TrainingAssignment): string | null =>
      assignment.versionId ?? courseById.get(assignment.courseId)?.currentVersionId ?? null
    const versions = await loadVersionsWithContent(
      client,
      open.map(versionIdFor).filter((id): id is string => Boolean(id))
    )
    const documentStatuses = await loadSigningStatuses(
      client,
      open.map((assignment) => assignment.signingDocumentId).filter((id): id is string => Boolean(id))
    )

    return inScope
      .map((employee): StaffReminderPerson => {
        const items: StaffReminderItem[] = open
          .filter((assignment) => assignment.employeeId === employee.employee_id)
          .map((assignment) => {
            const course = courseById.get(assignment.courseId) as TrainingCourse
            const versionId = versionIdFor(assignment)
            const content = versionId ? versions.get(versionId)?.content ?? null : null
            const documentStatus = assignment.signingDocumentId ? documentStatuses.get(assignment.signingDocumentId) : undefined
            return {
              assignmentId: assignment.id,
              courseId: course.id,
              courseTitle: course.title,
              courseKind: course.kind,
              status: assignment.status,
              assignedOn: assignment.assignedOn,
              dueOn: assignment.dueOn,
              confirmationSettled: documentStatus === 'completed' || documentStatus === 'superseded',
              progress: progressSummary(content, assignment),
            }
          })
        const email = employee.email_address?.trim() || null
        return {
          employeeId: employee.employee_id,
          name: displayName(employee),
          email,
          employeeStatus: asEmployeeStatus(employee.status),
          hasLogin: Boolean(employee.auth_user_id),
          paused: isPausedOn(profiles.get(employee.employee_id) ?? null, today),
          emailSuppressed: email ? suppressed.has(email.toLowerCase()) : false,
          items,
        }
      })
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
  }

  /** The snapshot the manager email plans from. */
  static async getManagerDailySnapshot(
    today: string
  ): Promise<Pick<ManagerDailyInput, 'assignments' | 'people' | 'certificateFailures'>> {
    const client = admin()
    const courses = await loadCourses(client)
    const courseById = new Map(courses.map((course) => [course.id, course]))
    const open = await loadOpenAssignments(client)
    const retries = await TrainingService.listCertificateRetries()
    const employees = await loadEmployeesByStatus(client, IN_SCOPE_STATUSES)
    const employeeById = new Map(employees.map((employee) => [employee.employee_id, employee]))
    const profiles = await loadProfiles(client, employees.map((employee) => employee.employee_id))
    const suppressed = await loadSuppressedEmails(
      client,
      employees.map((employee) => employee.email_address).filter((email): email is string => Boolean(email))
    )
    const nameOf = (employee: EmployeeRecord): string => displayName(employee)

    const assignments: ManagerDailyAssignment[] = open
      .filter((assignment) => employeeById.has(assignment.employeeId) && courseById.has(assignment.courseId))
      .map((assignment) => {
        const employee = employeeById.get(assignment.employeeId) as EmployeeRecord
        const course = courseById.get(assignment.courseId) as TrainingCourse
        return {
          assignmentId: assignment.id,
          employeeId: assignment.employeeId,
          employeeName: nameOf(employee),
          courseId: course.id,
          courseTitle: course.title,
          isEssentials: course.isEssentials,
          status: assignment.status,
          dueOn: assignment.dueOn,
          lockedSection: assignment.lockedSection,
          lockedAt: assignment.lockedAt,
          declinedAt: assignment.declinedAt,
          paused: isPausedOn(profiles.get(assignment.employeeId) ?? null, today),
        }
      })

    const people: ManagerDailyPerson[] = employees.map((employee) => {
      const email = employee.email_address?.trim().toLowerCase() || null
      return {
        employeeId: employee.employee_id,
        employeeName: nameOf(employee),
        hasLogin: Boolean(employee.auth_user_id),
        emailUndeliverable: email === null || suppressed.has(email),
        hasOpenTraining: open.some(
          (assignment) => assignment.employeeId === employee.employee_id && courseById.get(assignment.courseId)?.kind === 'online'
        ),
      }
    })

    const certificateFailures = retries
      .filter((assignment) => employeeById.has(assignment.employeeId))
      .map((assignment) => ({
        assignmentId: assignment.id,
        employeeId: assignment.employeeId,
        employeeName: nameOf(employeeById.get(assignment.employeeId) as EmployeeRecord),
        courseTitle: courseById.get(assignment.courseId)?.title ?? 'Training',
      }))

    return { assignments, people, certificateFailures }
  }

  /** Claim keys already held for any of the given assignments, employees or exact keys. */
  static async listReminderClaimKeys(filter: {
    assignmentIds?: readonly string[]
    employeeIds?: readonly string[]
    claimKeys?: readonly string[]
  }): Promise<Set<string>> {
    const client = admin()
    const keys = new Set<string>()
    const collect = (rows: Array<{ claim_key: string }>): void => {
      for (const row of rows) keys.add(row.claim_key)
    }
    for (const chunk of chunked(unique(filter.assignmentIds ?? []))) {
      collect(
        await fetchAllRows<{ claim_key: string }>(
          (from, to) =>
            client.from('training_reminders').select('claim_key').in('assignment_id', chunk).order('id', { ascending: true }).range(from, to),
          { label: 'training: reminder claims by item' }
        )
      )
    }
    for (const chunk of chunked(unique(filter.employeeIds ?? []))) {
      collect(
        await fetchAllRows<{ claim_key: string }>(
          (from, to) =>
            client.from('training_reminders').select('claim_key').in('employee_id', chunk).order('id', { ascending: true }).range(from, to),
          { label: 'training: reminder claims by person' }
        )
      )
    }
    for (const chunk of chunked(unique(filter.claimKeys ?? []))) {
      const { data, error } = await client.from('training_reminders').select('claim_key').in('claim_key', chunk)
      if (error) dbFailure('training_reminders', 'Reading reminder claims', error)
      collect((data ?? []) as Array<{ claim_key: string }>)
    }
    return keys
  }

  /** Claims a key before sending. False when it is already held (unique violation): someone else sent it. */
  static async claimReminder(claim: NewReminderClaim): Promise<boolean> {
    const { error } = await admin()
      .from('training_reminders')
      .insert({
        kind: claim.kind,
        claim_key: claim.claimKey,
        london_date: claim.londonDate,
        assignment_id: claim.assignmentId ?? null,
        employee_id: claim.employeeId ?? null,
        status: 'claimed',
        detail: claim.detail ?? {},
      })
      .select('id')
      .single()
    if (error && isUniqueViolation(error)) return false
    if (error) dbFailure('training_reminders', `Claiming ${claim.claimKey}`, error)
    return true
  }

  /** Marks a held claim sent or uncertain after the send. */
  static async setReminderStatus(
    claimKey: string,
    status: Exclude<TrainingReminderStatus, 'claimed'>,
    detail?: Record<string, unknown>
  ): Promise<void> {
    const row: Record<string, unknown> = { status }
    if (detail !== undefined) row.detail = detail
    const { data, error } = await admin().from('training_reminders').update(row).eq('claim_key', claimKey).select('id')
    if (error) dbFailure('training_reminders', `Marking ${claimKey} ${status}`, error)
    if (((data ?? []) as unknown[]).length === 0) {
      throw new Error(`[training_reminders] Marking ${claimKey} ${status} failed: the claim is not held`)
    }
  }

  /** Releases claims after a definite refusal or a suspended send, so the next run tries again. */
  static async releaseReminders(claimKeys: readonly string[]): Promise<void> {
    const client = admin()
    for (const chunk of chunked(unique(claimKeys))) {
      const { error } = await client.from('training_reminders').delete().in('claim_key', chunk)
      if (error) dbFailure('training_reminders', 'Releasing reminder claims', error)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers used above
// ---------------------------------------------------------------------------------------------

function daysOverdueOf(dueOn: string, today: string): number | null {
  const due = Date.parse(`${dueOn}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null
  const days = Math.round((now - due) / 86_400_000)
  return days > 0 ? days : null
}

function versionRefOf(meta: TrainingCourseVersionMeta): VersionRef | null {
  if (meta.major === null || meta.minor === null || meta.publishedAt === null) return null
  return { id: meta.id, major: meta.major, minor: meta.minor, publishedAt: meta.publishedAt }
}

/** Counts for a course page: open cycles by state, and people by their latest result. */
function courseStats(cycles: readonly TrainingAssignment[], today: string): CourseStats {
  const stats: CourseStats = { open: 0, overdue: 0, locked: 0, awaitingConfirmation: 0, declined: 0, completed: 0, expired: 0, waived: 0 }
  const byEmployee = new Map<string, TrainingAssignment[]>()
  for (const cycle of cycles) {
    const list = byEmployee.get(cycle.employeeId) ?? []
    list.push(cycle)
    byEmployee.set(cycle.employeeId, list)
  }
  for (const own of byEmployee.values()) {
    const open = own.find((cycle) => isOpenStatus(cycle.status))
    if (open) {
      stats.open += 1
      if (open.status === 'locked') stats.locked += 1
      if (open.status === 'awaiting_confirmation') stats.awaitingConfirmation += 1
      if (open.status === 'declined') stats.declined += 1
      if (open.dueOn !== null && open.dueOn < today) stats.overdue += 1
    }
    const completed = latestCompleted(own)
    if (completed) {
      if (completed.expiresOn !== null && completed.expiresOn < today) stats.expired += 1
      else stats.completed += 1
    }
    const latest = [...own].filter((cycle) => cycle.status !== 'cancelled').sort((a, b) => b.cycle - a.cycle)[0]
    if (latest?.status === 'waived') stats.waived += 1
  }
  return stats
}
