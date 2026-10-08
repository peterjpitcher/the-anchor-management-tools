import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'

import { createAdminClient } from '@/lib/supabase/admin'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { RECRUITMENT_CV_BUCKET } from '@/lib/recruitment/files'
import { deleteRecruitmentAppointmentCalendarEvent } from '@/lib/recruitment/calendar'

/**
 * What happens to a job applicant's details once they are 12 months old.
 *
 * OWNER DECISION (site review of 7 October 2026, package P07, follow-up to
 * decision 5): for everyone who was not taken on, keep a short record for good
 * (name, role, date, outcome and reason) and delete the CV and contact details
 * 12 months after they applied. The website's privacy notice states this word
 * for word, so this file is what makes that sentence true.
 *
 * WHO IT COVERS. Every candidate who was not hired, whatever state their
 * application was left in: rejected, withdrawn, duplicate, never decided, on
 * hold, or in the talent pool. The job this replaces covered only the first
 * three, so anybody whose application was simply never closed, or who was put
 * in the talent pool, was kept for ever. It also deleted the name, which the
 * decision says to keep.
 *
 * WHO IT LEAVES ALONE.
 *  - Anyone hired, or converted to an employee. They are staff, not applicants.
 *  - Anyone with an application newer than 12 months. The clock runs from the
 *    most recent application, so a person who applied two years ago and again
 *    last month keeps their CV until the newer application is 12 months old.
 *  - Anyone with an interview or trial shift still to come.
 *
 * WHAT IS KEPT, for good: first and last name, the role applied for, the date,
 * the outcome (the application status and its history) and the reason (the
 * rejection reason, and the note written when the decision was recorded).
 *
 * WHAT IS REMOVED: email, phone, location, the CV file and everything read from
 * it, free-text notes, consent ticks, the application's answers and cover note,
 * the AI's score, recommendation, rationale, strengths, concerns and flags, the
 * stored AI request and response, the comments and per-question scores on an
 * interview scorecard, the text of messages sent, booking link tokens, and the
 * calendar entries for interviews and trial shifts.
 *
 * DRY RUN. `dryRun: true` reads and counts and writes nothing: no update, no
 * delete, no file removed, no calendar call. The scheduled job and the button
 * on the recruitment page both run dry unless RECRUITMENT_RETENTION_APPLY is
 * set to `true`, so deploying this code removes nothing until the owner has
 * seen the numbers and switched it on.
 *
 * FAILS CLOSED. A candidate is marked as cleared last, after everything else
 * about them has gone. If any step fails (most importantly the CV file, which
 * used to be ignored, leaving a file in storage that nothing pointed to any
 * more), that candidate is left unmarked, reported in `failed`, and picked up
 * again on the next run.
 */

type GenericClient = SupabaseClient<any, 'public', any>

type Row = Record<string, any>

const DEFAULT_RETENTION_MONTHS = 12
const DEFAULT_BATCH_LIMIT = 100
const PAGE_SIZE = 200
const LONDON = 'Europe/London'

/** Written in place of a message's text. Also how a later run knows a message is already cleared. */
export const RETENTION_MESSAGE_PLACEHOLDER = '[removed after the recruitment retention period]'

/** Placeholders left by the job this replaces and by a GDPR erasure. Already cleared: not counted again. */
const ALREADY_CLEARED_MESSAGE_BODIES = new Set([
  RETENTION_MESSAGE_PLACEHOLDER,
  '[anonymised after recruitment retention period]',
  '[erased under GDPR request]',
])

/** Statuses that mean a decision was recorded and the person was not taken on. */
const DECIDED_STATUSES = new Set(['rejected', 'withdrawn', 'declined_duplicate'])

/**
 * Notes written when a decision was recorded (decideRecruitmentApplication
 * stores the reason as a note of this kind). They are the "reason" the owner
 * decided to keep. Every other note is free text about the person and goes.
 */
const REASON_NOTE_KINDS = new Set(['reject', 'offer', 'decline_duplicate', 'withdraw', 'hold'])

const CANDIDATE_CONTACT_FIELDS = ['email', 'phone', 'phone_e164', 'location'] as const
const CANDIDATE_CV_FIELDS = [
  'cv_file_path',
  'cv_file_name',
  'cv_mime_type',
  'cv_file_size_bytes',
  'cv_text',
  'cv_sha256',
  'cv_summary',
  'extracted_data',
  'provided_details',
] as const
const APPLICATION_ANSWER_FIELDS = [
  'cover_note',
  'relevant_experience_answer',
  'travel_answer',
  'start_availability',
  'availability',
] as const
const APPLICATION_AI_FIELDS = [
  'ai_score',
  'ai_recommendation',
  'ai_rationale',
  'ai_strengths',
  'ai_concerns',
  'ai_flags',
  'ai_model',
  'ai_scored_at',
  'ai_scored_against_version',
] as const
const AI_RUN_PAYLOAD_FIELDS = ['raw_response', 'structured_output', 'error_message'] as const

type RecruitmentRetentionCategory = 'decided' | 'undecided' | 'talent_pool' | 'no_application'

type RecruitmentRetentionSkipReason = 'hired' | 'recent_application' | 'upcoming_appointment'

interface RecruitmentRetentionCounts {
  /** People whose details are due to go. */
  candidates: number
  /** The same people, by how their most recent application was left. */
  byCategory: Record<RecruitmentRetentionCategory, number>
  /** CV files in storage. */
  cvFiles: number
  /** People with an email, phone or location still on file. */
  contactDetails: number
  /** People with CV text, a CV summary or details read from the CV still on file. */
  cvContent: number
  /** People with a free-text note on their own record. */
  candidateNotesField: number
  /** Applications with a cover note or an answer to a form question. */
  applicationAnswers: number
  /** Applications with an AI score, recommendation, rationale, strengths, concerns or flags. */
  applicationAiOutput: number
  /** Stored AI requests with a response or structured output. */
  aiRuns: number
  /** Notes about the person that are not a decision's reason. */
  notes: number
  /** Interview scorecards with comments or per-question scores. */
  scorecards: number
  /** Messages whose text is still stored. */
  messages: number
  /** Interviews and trial shifts with an entry in the shared calendar. */
  calendarEntries: number
}

interface RecruitmentRetentionFailure {
  candidateId: string
  step: string
  message: string
}

export interface RecruitmentRetentionResult {
  mode: 'dry_run' | 'applied'
  retentionMonths: number
  /** Applications before this instant are older than the retention period. */
  cutoff: string
  /** Everything that is due, whether or not this run reached it. */
  due: RecruitmentRetentionCounts
  /** People old enough to be looked at who were left alone, and why. */
  skipped: Record<RecruitmentRetentionSkipReason, number>
  /** People cleared by this run. Always 0 in a dry run. */
  cleared: number
  /** CV files removed by this run. Always 0 in a dry run. */
  cvFilesRemoved: number
  /** Calendar entries removed by this run. Always 0 in a dry run. */
  calendarEntriesRemoved: number
  /** Calendar entries that could not be removed because the calendar is not connected. */
  calendarEntriesLeft: number
  failed: RecruitmentRetentionFailure[]
  /** People still due after this run: beyond the batch limit, or failed. */
  remaining: number
}

interface RecruitmentRetentionOptions {
  /** Read and count only. Nothing is updated, deleted or removed. */
  dryRun?: boolean
  /** The most people to clear in one run. */
  limit?: number
  now?: Date
}

export function recruitmentRetentionMonths(): number {
  const parsed = Number.parseInt(process.env.RECRUITMENT_RETENTION_MONTHS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_MONTHS
}

/**
 * The switch. Off unless RECRUITMENT_RETENTION_APPLY is exactly `true`, the
 * same pattern as the operational scripts (dry run unless told otherwise).
 */
export function isRecruitmentRetentionApplyEnabled(): boolean {
  return process.env.RECRUITMENT_RETENTION_APPLY === 'true'
}

/**
 * The start of the London day that is `months` calendar months before today.
 *
 * Worked out on the London calendar, never the server's (UTC on Vercel), so
 * the answer is the same at 00:30 on a summer morning as at 23:30 the night
 * before. A day that does not exist in the earlier month is pulled back to that
 * month's last day: 31 October less eight months is 28 or 29 February.
 *
 * Someone who applied at any time on 10 October 2025 is first due on
 * 11 October 2026, so details are never removed early.
 */
export function recruitmentRetentionCutoff(now: Date, months: number): Date {
  const [year, month, day] = toLocalIsoDate(now).split('-').map(Number)
  const monthIndex = year * 12 + (month - 1) - months
  const cutoffYear = Math.floor(monthIndex / 12)
  const cutoffMonth = (monthIndex % 12) + 1
  const lastDayOfMonth = new Date(Date.UTC(cutoffYear, cutoffMonth, 0)).getUTCDate()
  const cutoffDay = Math.min(day, lastDayOfMonth)
  const iso = `${cutoffYear}-${String(cutoffMonth).padStart(2, '0')}-${String(cutoffDay).padStart(2, '0')}`
  return fromZonedTime(`${iso}T00:00:00`, LONDON)
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

function hasAny(row: Row, fields: readonly string[]): boolean {
  return fields.some((field) => hasValue(row[field]))
}

function emptyCounts(): RecruitmentRetentionCounts {
  return {
    candidates: 0,
    byCategory: { decided: 0, undecided: 0, talent_pool: 0, no_application: 0 },
    cvFiles: 0,
    contactDetails: 0,
    cvContent: 0,
    candidateNotesField: 0,
    applicationAnswers: 0,
    applicationAiOutput: 0,
    aiRuns: 0,
    notes: 0,
    scorecards: 0,
    messages: 0,
    calendarEntries: 0,
  }
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const value = row[key]
    if (typeof value !== 'string') continue
    const list = grouped.get(value) ?? []
    list.push(row)
    grouped.set(value, list)
  }
  return grouped
}

async function selectIn(
  supabase: GenericClient,
  table: string,
  columns: string,
  column: string,
  values: string[]
): Promise<Row[]> {
  if (values.length === 0) return []
  const rows: Row[] = []
  // In slices, so a long list of ids never becomes an over-long request.
  for (let start = 0; start < values.length; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(column, values.slice(start, start + PAGE_SIZE))
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
  }
  return rows
}

interface DueCandidate {
  candidate: Row
  category: RecruitmentRetentionCategory
  applications: Row[]
  appointmentsWithCalendarEntry: Row[]
  appointmentsWithToken: Row[]
  aiRunIds: string[]
  noteIdsToDelete: string[]
  scorecardIds: string[]
  messageIds: string[]
  /** True when the candidate record itself still holds something to remove. */
  candidateHoldsData: boolean
}

/**
 * A stored time as a number. The database answers `2025-10-07T23:00:00+00:00`
 * and JavaScript writes `2025-10-07T23:00:00.000Z` for the same instant, so the
 * two are never compared as text. A time that cannot be read is treated as
 * "now": too recent to be due, which errs on the side of removing nothing.
 */
function instant(value: unknown): number {
  const parsed = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function categoryFor(applications: Row[]): RecruitmentRetentionCategory {
  if (applications.length === 0) return 'no_application'
  const latest = [...applications].sort((a, b) => instant(b.created_at) - instant(a.created_at))[0]
  if (DECIDED_STATUSES.has(latest.status)) return 'decided'
  if (latest.status === 'talent_pool') return 'talent_pool'
  return 'undecided'
}

async function findDueCandidates(
  supabase: GenericClient,
  cutoffIso: string,
  nowIso: string
): Promise<{ due: DueCandidate[]; skipped: Record<RecruitmentRetentionSkipReason, number> }> {
  const skipped: Record<RecruitmentRetentionSkipReason, number> = {
    hired: 0,
    recent_application: 0,
    upcoming_appointment: 0,
  }
  const due: DueCandidate[] = []
  const cutoffMs = new Date(cutoffIso).getTime()
  const nowMs = new Date(nowIso).getTime()

  // A candidate record is created with the first application, so nobody whose
  // record is newer than the cut-off can have every application older than it.
  const candidates: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('recruitment_candidates')
      .select(
        'id, created_at, anonymised_at, converted_employee_id, notes, sms_consent, future_recruitment_consent, ' +
          [...CANDIDATE_CONTACT_FIELDS, ...CANDIDATE_CV_FIELDS].join(', ')
      )
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Could not read recruitment_candidates: ${error.message}`)
    const page = (data ?? []) as Row[]
    candidates.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const candidateIds = candidates.map((candidate) => candidate.id as string)
  const applications = await selectIn(
    supabase,
    'recruitment_applications',
    'id, candidate_id, status, created_at, booking_token_hash, ' +
      [...APPLICATION_ANSWER_FIELDS, ...APPLICATION_AI_FIELDS].join(', '),
    'candidate_id',
    candidateIds
  )
  const applicationIds = applications.map((application) => application.id as string)

  const [appointments, notes, scorecards, messages, runsByCandidate, runsByApplication] = await Promise.all([
    selectIn(
      supabase,
      'recruitment_candidate_appointments',
      'id, candidate_id, status, scheduled_start, calendar_event_id, booking_token_hash',
      'candidate_id',
      candidateIds
    ),
    selectIn(supabase, 'recruitment_candidate_notes', 'id, candidate_id, kind', 'candidate_id', candidateIds),
    selectIn(
      supabase,
      'recruitment_interview_scorecards',
      'id, candidate_id, comments, criteria',
      'candidate_id',
      candidateIds
    ),
    selectIn(supabase, 'recruitment_communications', 'id, candidate_id, final_body, subject', 'candidate_id', candidateIds),
    selectIn(
      supabase,
      'recruitment_ai_runs',
      'id, candidate_id, application_id, ' + AI_RUN_PAYLOAD_FIELDS.join(', '),
      'candidate_id',
      candidateIds
    ),
    selectIn(
      supabase,
      'recruitment_ai_runs',
      'id, candidate_id, application_id, ' + AI_RUN_PAYLOAD_FIELDS.join(', '),
      'application_id',
      applicationIds
    ),
  ])

  const applicationsByCandidate = groupBy(applications, 'candidate_id')
  const appointmentsByCandidate = groupBy(appointments, 'candidate_id')
  const notesByCandidate = groupBy(notes, 'candidate_id')
  const scorecardsByCandidate = groupBy(scorecards, 'candidate_id')
  const messagesByCandidate = groupBy(messages, 'candidate_id')
  const candidateByApplication = new Map(
    applications.map((application) => [application.id as string, application.candidate_id as string])
  )

  // An AI run can point at the candidate, the application or both. Each is counted once.
  const runsByOwner = new Map<string, Map<string, Row>>()
  for (const run of [...runsByCandidate, ...runsByApplication]) {
    const owner =
      (typeof run.candidate_id === 'string' && run.candidate_id) ||
      (typeof run.application_id === 'string' ? candidateByApplication.get(run.application_id) : undefined)
    if (!owner) continue
    const runs = runsByOwner.get(owner) ?? new Map<string, Row>()
    runs.set(run.id as string, run)
    runsByOwner.set(owner, runs)
  }

  for (const candidate of candidates) {
    const id = candidate.id as string
    const ownApplications = applicationsByCandidate.get(id) ?? []
    const ownAppointments = appointmentsByCandidate.get(id) ?? []

    if (candidate.converted_employee_id || ownApplications.some((application) => application.status === 'hired')) {
      skipped.hired += 1
      continue
    }

    // Asked again here, in numbers, although the query above already filtered on
    // it: this is the line that decides whether somebody's CV is deleted.
    if (instant(candidate.created_at) >= cutoffMs) {
      skipped.recent_application += 1
      continue
    }

    if (ownApplications.some((application) => instant(application.created_at) >= cutoffMs)) {
      skipped.recent_application += 1
      continue
    }

    if (
      ownAppointments.some(
        (appointment) => appointment.status === 'scheduled' && instant(appointment.scheduled_start) > nowMs
      )
    ) {
      skipped.upcoming_appointment += 1
      continue
    }

    const candidateHoldsData =
      hasAny(candidate, CANDIDATE_CONTACT_FIELDS) ||
      hasAny(candidate, CANDIDATE_CV_FIELDS) ||
      hasValue(candidate.notes) ||
      candidate.sms_consent === true ||
      candidate.future_recruitment_consent === true

    const entry: DueCandidate = {
      candidate,
      category: categoryFor(ownApplications),
      applications: ownApplications,
      appointmentsWithCalendarEntry: ownAppointments.filter((appointment) => hasValue(appointment.calendar_event_id)),
      appointmentsWithToken: ownAppointments.filter((appointment) => hasValue(appointment.booking_token_hash)),
      aiRunIds: [...(runsByOwner.get(id)?.values() ?? [])]
        .filter((run) => hasAny(run, AI_RUN_PAYLOAD_FIELDS))
        .map((run) => run.id as string),
      noteIdsToDelete: (notesByCandidate.get(id) ?? [])
        .filter((note) => !REASON_NOTE_KINDS.has(note.kind))
        .map((note) => note.id as string),
      scorecardIds: (scorecardsByCandidate.get(id) ?? [])
        .filter((scorecard) => hasValue(scorecard.comments) || hasValue(scorecard.criteria))
        .map((scorecard) => scorecard.id as string),
      messageIds: (messagesByCandidate.get(id) ?? [])
        .filter((message) => !ALREADY_CLEARED_MESSAGE_BODIES.has(message.final_body) || hasValue(message.subject))
        .map((message) => message.id as string),
      candidateHoldsData,
    }

    // A person already cleared, with nothing left behind, is finished. One
    // cleared by the job this replaces can still have answers, AI output and
    // calendar entries, which that job never touched, so they come round again.
    const hasResidue =
      entry.applications.some(
        (application) =>
          hasAny(application, APPLICATION_ANSWER_FIELDS) ||
          hasAny(application, APPLICATION_AI_FIELDS) ||
          hasValue(application.booking_token_hash)
      ) ||
      entry.appointmentsWithCalendarEntry.length > 0 ||
      entry.appointmentsWithToken.length > 0 ||
      entry.aiRunIds.length > 0 ||
      entry.noteIdsToDelete.length > 0 ||
      entry.scorecardIds.length > 0 ||
      entry.messageIds.length > 0

    if (candidate.anonymised_at && !candidateHoldsData && !hasResidue) continue

    due.push(entry)
  }

  return { due, skipped }
}

function countDue(due: DueCandidate[]): RecruitmentRetentionCounts {
  const counts = emptyCounts()
  for (const entry of due) {
    counts.candidates += 1
    counts.byCategory[entry.category] += 1
    if (hasValue(entry.candidate.cv_file_path)) counts.cvFiles += 1
    if (hasAny(entry.candidate, CANDIDATE_CONTACT_FIELDS)) counts.contactDetails += 1
    if (hasAny(entry.candidate, ['cv_text', 'cv_summary', 'extracted_data', 'provided_details'])) counts.cvContent += 1
    if (hasValue(entry.candidate.notes)) counts.candidateNotesField += 1
    counts.applicationAnswers += entry.applications.filter((application) =>
      hasAny(application, APPLICATION_ANSWER_FIELDS)
    ).length
    counts.applicationAiOutput += entry.applications.filter((application) =>
      hasAny(application, APPLICATION_AI_FIELDS)
    ).length
    counts.aiRuns += entry.aiRunIds.length
    counts.notes += entry.noteIdsToDelete.length
    counts.scorecards += entry.scorecardIds.length
    counts.messages += entry.messageIds.length
    counts.calendarEntries += entry.appointmentsWithCalendarEntry.length
  }
  return counts
}

class RetentionStepError extends Error {
  constructor(
    readonly step: string,
    message: string
  ) {
    super(message)
  }
}

async function must(step: string, write: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await write
  if (error) throw new RetentionStepError(step, error.message)
}

function nulled(fields: readonly string[]): Row {
  return Object.fromEntries(fields.map((field) => [field, null]))
}

async function clearCandidate(
  supabase: GenericClient,
  entry: DueCandidate,
  nowIso: string
): Promise<{ cvFileRemoved: boolean; calendarEntriesRemoved: number; calendarEntriesLeft: number }> {
  const candidateId = entry.candidate.id as string
  const applicationIds = entry.applications.map((application) => application.id as string)
  let calendarEntriesRemoved = 0
  let calendarEntriesLeft = 0

  // 1. Calendar entries. They name the candidate, and the calendar is shared.
  for (const appointment of entry.appointmentsWithCalendarEntry) {
    let result: { deleted: boolean; reason?: string }
    try {
      result = await deleteRecruitmentAppointmentCalendarEvent(appointment.id as string, supabase)
    } catch (error) {
      throw new RetentionStepError('calendar', error instanceof Error ? error.message : String(error))
    }
    if (result.deleted) {
      calendarEntriesRemoved += 1
    } else if (result.reason === 'not_configured') {
      // No calendar is connected, so there is nothing this code can reach. The
      // rest still goes: holding a CV for ever because a calendar was
      // disconnected would be the worse failure. Counted so it is not hidden.
      calendarEntriesLeft += 1
    } else if (result.reason !== 'not_synced') {
      throw new RetentionStepError('calendar', result.reason ?? 'Calendar entry could not be removed')
    }
  }

  // 2. The CV file. If it cannot be removed, stop: clearing its path from the
  //    record would leave the file in storage with nothing pointing at it.
  let cvFileRemoved = false
  const cvPath = entry.candidate.cv_file_path
  if (typeof cvPath === 'string' && cvPath.length > 0) {
    let removeError: { message: string } | null
    try {
      const removal = await supabase.storage.from(RECRUITMENT_CV_BUCKET).remove([cvPath])
      removeError = removal.error
    } catch (error) {
      removeError = { message: error instanceof Error ? error.message : String(error) }
    }
    if (removeError) throw new RetentionStepError('cv_file', removeError.message)
    cvFileRemoved = true
  }

  // 3. Answers, AI output and booking link tokens on every application. Status,
  //    rejection reason, role and dates stay: they are the short record.
  if (applicationIds.length > 0) {
    await must(
      'applications',
      supabase
        .from('recruitment_applications')
        .update({
          ...nulled(APPLICATION_ANSWER_FIELDS),
          ...nulled(APPLICATION_AI_FIELDS),
          booking_token_hash: null,
          booking_token_type: null,
          booking_token_expires_at: null,
        })
        .in('id', applicationIds)
    )
  }

  // 4. What was sent to and came back from the AI. It can hold the name, email
  //    and phone the model read off the CV. The row stays for the cost figures.
  if (entry.aiRunIds.length > 0) {
    await must(
      'ai_runs',
      supabase.from('recruitment_ai_runs').update(nulled(AI_RUN_PAYLOAD_FIELDS)).in('id', entry.aiRunIds)
    )
  }

  // 5. Free-text notes about the person. Decision reasons are kept.
  if (entry.noteIdsToDelete.length > 0) {
    await must('notes', supabase.from('recruitment_candidate_notes').delete().in('id', entry.noteIdsToDelete))
  }

  // 6. Interview scorecards: comments and per-question scores go, the overall
  //    rating and recommendation stay as part of the outcome.
  if (entry.scorecardIds.length > 0) {
    await must(
      'scorecards',
      supabase
        .from('recruitment_interview_scorecards')
        .update({ comments: null, criteria: [] })
        .in('id', entry.scorecardIds)
    )
  }

  // 7. The text of every message sent. That one went, when and by which channel stays.
  if (entry.messageIds.length > 0) {
    await must(
      'messages',
      supabase
        .from('recruitment_communications')
        .update({ final_body: RETENTION_MESSAGE_PLACEHOLDER, subject: null })
        .in('id', entry.messageIds)
    )
  }

  // 8. Booking link tokens on appointments. The appointment itself stays.
  if (entry.appointmentsWithToken.length > 0) {
    await must(
      'appointments',
      supabase
        .from('recruitment_candidate_appointments')
        .update({ booking_token_hash: null, token_expires_at: null })
        .in(
          'id',
          entry.appointmentsWithToken.map((appointment) => appointment.id as string)
        )
    )
  }

  // 9. The candidate, last. Setting anonymised_at is what marks them done, so a
  //    failure anywhere above leaves them to be picked up again. The name stays.
  await must(
    'candidate',
    supabase
      .from('recruitment_candidates')
      .update({
        ...nulled(CANDIDATE_CONTACT_FIELDS),
        ...nulled(CANDIDATE_CV_FIELDS),
        notes: null,
        sms_consent: false,
        sms_consent_at: null,
        future_recruitment_consent: false,
        future_recruitment_consent_at: null,
        anonymised_at: entry.candidate.anonymised_at ?? nowIso,
      })
      .eq('id', candidateId)
  )

  return { cvFileRemoved, calendarEntriesRemoved, calendarEntriesLeft }
}

export async function runRecruitmentRetentionCleanup(
  options: RecruitmentRetentionOptions = {},
  supabase: GenericClient = createAdminClient()
): Promise<RecruitmentRetentionResult> {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const months = recruitmentRetentionMonths()
  const cutoffIso = recruitmentRetentionCutoff(now, months).toISOString()
  const dryRun = options.dryRun === true
  const limit = Math.max(1, options.limit ?? DEFAULT_BATCH_LIMIT)

  const { due, skipped } = await findDueCandidates(supabase, cutoffIso, nowIso)

  const result: RecruitmentRetentionResult = {
    mode: dryRun ? 'dry_run' : 'applied',
    retentionMonths: months,
    cutoff: cutoffIso,
    due: countDue(due),
    skipped,
    cleared: 0,
    cvFilesRemoved: 0,
    calendarEntriesRemoved: 0,
    calendarEntriesLeft: 0,
    failed: [],
    remaining: due.length,
  }

  if (dryRun) return result

  for (const entry of due.slice(0, limit)) {
    const candidateId = entry.candidate.id as string
    try {
      const outcome = await clearCandidate(supabase, entry, nowIso)
      result.cleared += 1
      if (outcome.cvFileRemoved) result.cvFilesRemoved += 1
      result.calendarEntriesRemoved += outcome.calendarEntriesRemoved
      result.calendarEntriesLeft += outcome.calendarEntriesLeft
    } catch (error) {
      result.failed.push({
        candidateId,
        step: error instanceof RetentionStepError ? error.step : 'unknown',
        // The provider's own words, cut short. Never a name or an address: the
        // steps above pass ids, and the candidate is named here by id only.
        message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      })
    }
  }

  result.remaining = due.length - result.cleared
  return result
}
