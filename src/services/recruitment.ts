import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildRecruitmentCvStoragePath,
  getRecruitmentCvMaxBytes,
  parseRecruitmentCv,
  RECRUITMENT_CV_BUCKET,
  validateRecruitmentCvUpload,
} from '@/lib/recruitment/files'
import {
  extractRecruitmentCandidateFromCv,
  scoreRecruitmentApplication,
} from '@/lib/recruitment/ai'
import {
  RecruitmentApplicationInputSchema,
  RecruitmentAppointmentOutcomeInputSchema,
  RecruitmentAppointmentSlotInputSchema,
  RecruitmentCandidateProfileInputSchema,
  RecruitmentJobPostingInputSchema,
  type RecruitmentApplication,
  type RecruitmentApplicationInput,
  type RecruitmentAppointmentOutcomeInput,
  type RecruitmentAppointmentSlotInput,
  type RecruitmentAppointmentType,
  type RecruitmentCandidate,
  type RecruitmentCandidateProfileInput,
  type RecruitmentCvUpload,
  type RecruitmentDashboard,
  type RecruitmentJobPosting,
} from '@/types/recruitment'

type GenericClient = SupabaseClient<any, 'public', any>
type ParsedRecruitmentCv = Awaited<ReturnType<typeof parseRecruitmentCv>>

const TERMINAL_NON_HIRED_STATUSES = ['rejected', 'withdrawn', 'declined_duplicate'] as const
const AWAITING_BOOKING_STATUSES = ['interview_invited', 'trial_offered'] as const
const OFFER_STATUSES = ['offered'] as const

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function recruitmentBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://manage.the-anchor.pub'
}

function retentionMonths(): number {
  const parsed = Number.parseInt(process.env.RECRUITMENT_RETENTION_MONTHS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function candidateName(candidate: Pick<RecruitmentCandidate, 'first_name' | 'last_name' | 'email'>): string {
  return [candidate.first_name, candidate.last_name].filter(Boolean).join(' ').trim() || candidate.email || 'Candidate'
}

function candidateAiContext(candidate: RecruitmentCandidate): string[] {
  const context = []

  if (candidate.cv_text) {
    context.push(`Raw CV text:\n${candidate.cv_text}`)
  }

  if (candidate.cv_summary) {
    context.push(`CV summary:\n${candidate.cv_summary}`)
  }

  if (candidate.extracted_data && typeof candidate.extracted_data === 'object') {
    context.push(`Structured CV profile:\n${JSON.stringify(candidate.extracted_data, null, 2)}`)
  }

  if (candidate.provided_details) {
    context.push(`Candidate-provided details:\n${candidate.provided_details}`)
  }

  if (candidate.notes) {
    context.push(`Manager notes:\n${candidate.notes}`)
  }

  return context
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isInfrastructureStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /network|timeout|storage|supabase|database|fetch/i.test(message)
}

async function insertStatusEvent(
  supabase: GenericClient,
  input: {
    applicationId: string
    fromStatus?: string | null
    toStatus: string
    changedBy?: string | null
    note?: string | null
    metadata?: Record<string, unknown> | null
  }
) {
  const { error } = await supabase.from('recruitment_application_status_events').insert({
    application_id: input.applicationId,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus,
    changed_by: input.changedBy ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? null,
  })
  if (error) {
    throw error
  }
}

async function storeCvForCandidate(
  supabase: GenericClient,
  candidateId: string,
  upload: RecruitmentCvUpload,
  kind: 'public' | 'admin',
  parsedCvOverride?: ParsedRecruitmentCv | null
) {
  const validationError = validateRecruitmentCvUpload(upload, {
    maxBytes: getRecruitmentCvMaxBytes(kind),
  })
  if (validationError) {
    throw new Error(validationError)
  }

  const path = buildRecruitmentCvStoragePath(candidateId, upload)
  const { data, error } = await supabase.storage
    .from(RECRUITMENT_CV_BUCKET)
    .upload(path, upload.buffer, {
      contentType: upload.mimeType || 'application/octet-stream',
      upsert: false,
    })

  if (error) {
    throw new Error(`CV storage failed: ${error.message}`)
  }

  const parsedCv = parsedCvOverride ?? await parseRecruitmentCv(upload)

  return {
    path: data?.path ?? path,
    extractionStatus: parsedCv.status,
    extractedText: parsedCv.text,
    extractionError: parsedCv.status === 'done' ? null : parsedCv.error,
  }
}

export async function listPublicRecruitmentPostings(supabase: GenericClient = createAdminClient()) {
  const { data, error } = await supabase
    .from('recruitment_job_postings')
    .select('id, title, slug, role_type, description, requirements, employment_type, positions_available, opened_at, updated_at')
    .eq('status', 'open')
    .eq('is_public', true)
    .order('opened_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data ?? []
}

export const RECRUITMENT_CANDIDATES_PAGE_SIZE = 25

export type RecruitmentCandidatesPageParams = {
  page?: number
  pageSize?: number
  search?: string | null
  extractionStatus?: string | null
  source?: string | null
  converted?: 'yes' | 'no' | null
}

export type RecruitmentCandidatesPage = {
  candidates: RecruitmentCandidate[]
  totalCount: number
  page: number
  pageSize: number
}

/**
 * Server-side paginated, searchable, filterable list of candidates (talent pool).
 * Mirrors the getCustomerList shape: parallel exact-count + data queries with
 * .or(ilike) search, .eq/.is filters, and .range() pagination. Used both for the
 * dashboard's initial talent-pool page and for client-side page/filter changes.
 */
export async function getRecruitmentCandidatesPage(
  supabase: GenericClient = createAdminClient(),
  params: RecruitmentCandidatesPageParams = {},
): Promise<RecruitmentCandidatesPage> {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? RECRUITMENT_CANDIDATES_PAGE_SIZE)))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // Strip PostgREST .or() control characters (% and ,) from the search term.
  const term = params.search?.trim().replace(/[%,]/g, ' ').trim()
  const orFilter = term ? `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%` : null

  let countQuery = supabase.from('recruitment_candidates').select('id', { count: 'exact', head: true })
  let dataQuery = supabase.from('recruitment_candidates').select('*')

  if (orFilter) {
    countQuery = countQuery.or(orFilter)
    dataQuery = dataQuery.or(orFilter)
  }
  if (params.extractionStatus) {
    countQuery = countQuery.eq('cv_extraction_status', params.extractionStatus)
    dataQuery = dataQuery.eq('cv_extraction_status', params.extractionStatus)
  }
  if (params.source) {
    countQuery = countQuery.eq('source', params.source)
    dataQuery = dataQuery.eq('source', params.source)
  }
  if (params.converted === 'yes') {
    countQuery = countQuery.not('converted_employee_id', 'is', null)
    dataQuery = dataQuery.not('converted_employee_id', 'is', null)
  } else if (params.converted === 'no') {
    countQuery = countQuery.is('converted_employee_id', null)
    dataQuery = dataQuery.is('converted_employee_id', null)
  }

  const [countResult, dataResult] = await Promise.all([
    countQuery,
    dataQuery.order('created_at', { ascending: false }).range(from, to),
  ])

  if (countResult.error) throw countResult.error
  if (dataResult.error) throw dataResult.error

  return {
    candidates: (dataResult.data ?? []) as RecruitmentCandidate[],
    totalCount: countResult.count ?? 0,
    page,
    pageSize,
  }
}

export async function listRecruitmentAdminData(supabase: GenericClient = createAdminClient()) {
  const [postings, applications, candidatesPage, slots, appointments, templates, statusEvents, aiRuns, communications] = await Promise.all([
    supabase
      .from('recruitment_job_postings')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('recruitment_applications')
      .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
      .order('created_at', { ascending: false })
      .limit(100),
    getRecruitmentCandidatesPage(supabase, { page: 1, pageSize: RECRUITMENT_CANDIDATES_PAGE_SIZE }),
    supabase
      .from('recruitment_appointment_slots')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(100),
    supabase
      .from('recruitment_candidate_appointments')
      .select('*, candidate:recruitment_candidates(first_name,last_name,email), application:recruitment_applications(id,status,job_posting:recruitment_job_postings(title))')
      .order('scheduled_start', { ascending: false })
      .limit(150),
    supabase
      .from('recruitment_email_templates')
      .select('*')
      .eq('is_active', true)
      .order('type', { ascending: true }),
    supabase
      .from('recruitment_application_status_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('recruitment_ai_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('recruitment_communications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  for (const result of [postings, applications, slots, appointments, templates, statusEvents, aiRuns, communications]) {
    if (result.error) throw result.error
  }

  return {
    postings: postings.data ?? [],
    applications: applications.data ?? [],
    candidates: candidatesPage.candidates,
    candidatesTotal: candidatesPage.totalCount,
    slots: slots.data ?? [],
    appointments: appointments.data ?? [],
    templates: templates.data ?? [],
    statusEvents: statusEvents.data ?? [],
    aiRuns: aiRuns.data ?? [],
    communications: communications.data ?? [],
  }
}

export async function getRecruitmentDashboard(
  supabase: GenericClient = createAdminClient()
): Promise<RecruitmentDashboard> {
  const nowIso = new Date().toISOString()
  const retentionCutoff = addMonths(new Date(), -retentionMonths()).toISOString()

  const [
    recentApplications,
    newApplications,
    fastTrack,
    manualReview,
    awaitingBooking,
    upcomingAppointments,
    offers,
    retentionDue,
  ] = await Promise.all([
    supabase
      .from('recruitment_applications')
      .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('recruitment_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new'),
    supabase
      .from('recruitment_applications')
      .select('id', { count: 'exact', head: true })
      .eq('ai_recommendation', 'fast_track')
      .not('status', 'in', `(${['rejected', 'hired', 'withdrawn'].join(',')})`),
    supabase
      .from('recruitment_candidates')
      .select('id', { count: 'exact', head: true })
      .in('cv_extraction_status', ['failed', 'unsupported']),
    supabase
      .from('recruitment_applications')
      .select('id', { count: 'exact', head: true })
      .in('status', AWAITING_BOOKING_STATUSES as unknown as string[]),
    supabase
      .from('recruitment_candidate_appointments')
      .select('*, candidate:recruitment_candidates(first_name,last_name,email), application:recruitment_applications(id, status, job_posting:recruitment_job_postings(title))')
      .eq('status', 'scheduled')
      .gte('scheduled_start', nowIso)
      .order('scheduled_start', { ascending: true })
      .limit(10),
    supabase
      .from('recruitment_applications')
      .select('id', { count: 'exact', head: true })
      .in('status', OFFER_STATUSES as unknown as string[]),
    supabase
      .from('recruitment_applications')
      .select('id', { count: 'exact', head: true })
      .in('status', TERMINAL_NON_HIRED_STATUSES as unknown as string[])
      .lt('created_at', retentionCutoff),
  ])

  for (const result of [
    recentApplications,
    newApplications,
    fastTrack,
    manualReview,
    awaitingBooking,
    upcomingAppointments,
    offers,
    retentionDue,
  ]) {
    if (result.error) throw result.error
  }

  const counts = {
    newApplications: newApplications.count ?? 0,
    fastTrack: fastTrack.count ?? 0,
    manualReview: manualReview.count ?? 0,
    awaitingBooking: awaitingBooking.count ?? 0,
    upcomingAppointments: upcomingAppointments.data?.length ?? 0,
    offers: offers.count ?? 0,
    retentionDue: retentionDue.count ?? 0,
  }

  return {
    counts,
    recentApplications: (recentApplications.data ?? []) as RecruitmentApplication[],
    upcomingAppointments: upcomingAppointments.data ?? [],
    actionItems: [
      { id: 'new', label: 'New applications', count: counts.newApplications, href: '/recruitment?status=new' },
      { id: 'fast_track', label: 'Fast-track candidates', count: counts.fastTrack, href: '/recruitment?recommendation=fast_track' },
      { id: 'manual_review', label: 'Manual CV review', count: counts.manualReview, href: '/recruitment?review=cv' },
      { id: 'awaiting_booking', label: 'Awaiting booking', count: counts.awaitingBooking, href: '/recruitment?status=awaiting_booking' },
      { id: 'appointments', label: 'Upcoming interviews/trials', count: counts.upcomingAppointments, href: '/recruitment?tab=schedule' },
      { id: 'offers', label: 'Offers', count: counts.offers, href: '/recruitment?status=offered' },
      { id: 'retention', label: 'Retention due', count: counts.retentionDue, href: '/recruitment?tab=retention' },
    ],
  }
}

export async function createRecruitmentJobPosting(
  input: unknown,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
): Promise<RecruitmentJobPosting> {
  const parsed = RecruitmentJobPostingInputSchema.parse(input)
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('recruitment_job_postings')
    .insert({
      ...parsed,
      created_by: currentUserId ?? null,
      opened_at: parsed.status === 'open' ? now : null,
      closed_at: parsed.status === 'closed' || parsed.status === 'archived' ? now : null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as RecruitmentJobPosting
}

export async function updateRecruitmentJobPosting(
  id: string,
  input: unknown,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
): Promise<RecruitmentJobPosting> {
  const parsed = RecruitmentJobPostingInputSchema.parse(input)
  const { data: existing, error: existingError } = await supabase
    .from('recruitment_job_postings')
    .select('*')
    .eq('id', id)
    .single()

  if (existingError) throw existingError

  const now = new Date().toISOString()
  const statusChanged = existing.status !== parsed.status
  const versionBumpNeeded =
    existing.title !== parsed.title ||
    existing.description !== parsed.description ||
    existing.requirements !== parsed.requirements ||
    existing.ai_scoring_notes !== parsed.ai_scoring_notes ||
    existing.role_type !== parsed.role_type ||
    existing.employment_type !== parsed.employment_type

  const { data, error } = await supabase
    .from('recruitment_job_postings')
    .update({
      ...parsed,
      version: versionBumpNeeded ? Number(existing.version ?? 1) + 1 : existing.version,
      opened_at: statusChanged && parsed.status === 'open' ? now : existing.opened_at,
      closed_at: statusChanged && ['closed', 'archived'].includes(parsed.status) ? now : existing.closed_at,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as RecruitmentJobPosting
}

export async function updateRecruitmentCandidateProfile(
  candidateId: string,
  input: RecruitmentCandidateProfileInput,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
): Promise<RecruitmentCandidate> {
  const parsed = RecruitmentCandidateProfileInputSchema.parse(input)
  const nowIso = new Date().toISOString()
  const rightToWorkStatus = parsed.right_to_work_status
  const rightToWorkCheckedAt = rightToWorkStatus === 'verified'
    ? (toIsoOrNull(parsed.right_to_work_checked_at) ?? nowIso)
    : parsed.right_to_work_checked_at === null
      ? null
      : undefined

  const updatePayload: Record<string, unknown> = {
    first_name: nullIfBlank(parsed.first_name),
    last_name: nullIfBlank(parsed.last_name),
    email: normalizeEmail(parsed.email),
    phone: nullIfBlank(parsed.phone),
    phone_e164: nullIfBlank(parsed.phone_e164),
    location: nullIfBlank(parsed.location),
    notes: nullIfBlank(parsed.notes),
  }

  if (parsed.sms_consent !== undefined) {
    updatePayload.sms_consent = parsed.sms_consent
    updatePayload.sms_consent_at = parsed.sms_consent ? nowIso : null
  }

  if (parsed.future_recruitment_consent !== undefined) {
    updatePayload.future_recruitment_consent = parsed.future_recruitment_consent
    updatePayload.future_recruitment_consent_at = parsed.future_recruitment_consent ? nowIso : null
  }

  if (rightToWorkStatus) {
    updatePayload.right_to_work_status = rightToWorkStatus
    updatePayload.right_to_work_checked_at = rightToWorkCheckedAt ?? null
    updatePayload.right_to_work_checked_by = rightToWorkStatus === 'verified' ? currentUserId ?? null : null
    updatePayload.right_to_work_document_type = rightToWorkStatus === 'verified'
      ? parsed.right_to_work_document_type ?? null
      : null
  }

  if (parsed.right_to_work_document_type !== undefined && !rightToWorkStatus) {
    updatePayload.right_to_work_document_type = parsed.right_to_work_document_type
  }

  const { data, error } = await supabase
    .from('recruitment_candidates')
    .update(updatePayload)
    .eq('id', candidateId)
    .select('*')
    .single()

  if (error) throw error
  return data as RecruitmentCandidate
}

async function runApplicationScoring(
  application: RecruitmentApplication,
  candidate: RecruitmentCandidate,
  supabase: GenericClient,
  currentUserId?: string | null
): Promise<{ application: RecruitmentApplication; scoringError: string | null }> {
  if (!application.job_posting_id || !application.job_posting) {
    return { application, scoringError: null }
  }

  const scoring = await scoreRecruitmentApplication(supabase, {
    applicationId: application.id,
    candidateId: candidate.id,
    jobPostingId: application.job_posting_id,
    posting: {
      title: application.job_posting.title,
      requirements: application.job_posting.requirements,
      ai_scoring_notes: application.job_posting.ai_scoring_notes,
      role_type: application.job_posting.role_type,
      version: application.job_posting.version,
    },
    candidateText: [
      ...candidateAiContext(candidate),
      application.cover_note,
      application.relevant_experience_answer,
      application.travel_answer,
      application.start_availability,
    ].filter(Boolean).join('\n\n'),
    availability: application.availability ?? null,
    coverNote: application.cover_note ?? null,
    relevantExperience: application.relevant_experience_answer ?? null,
    travel: application.travel_answer ?? null,
    startAvailability: application.start_availability ?? null,
  })

  if (!scoring.result) {
    return { application, scoringError: scoring.error ?? 'AI scoring failed' }
  }

  const result = scoring.result
  const { data, error } = await supabase
    .from('recruitment_applications')
    .update({
      status: 'ai_screened',
      ai_score: result.score,
      ai_recommendation: result.recommendation,
      ai_rationale: result.rationale,
      ai_strengths: result.strengths,
      ai_concerns: result.concerns,
      ai_flags: result.flags,
      latest_ai_run_id: scoring.runId,
      ai_scored_at: new Date().toISOString(),
      ai_scored_against_version: application.job_posting.version,
    })
    .eq('id', application.id)
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .single()

  if (error) throw error

  await insertStatusEvent(supabase, {
    applicationId: application.id,
    fromStatus: application.status,
    toStatus: 'ai_screened',
    changedBy: currentUserId ?? null,
    note: 'AI screen completed',
    metadata: { run_id: scoring.runId, manual_rerun: application.ai_scored_at != null },
  })

  return { application: data as RecruitmentApplication, scoringError: null }
}

export async function rescoreRecruitmentApplication(
  applicationId: string,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
): Promise<{ application: RecruitmentApplication; scoringError: string | null }> {
  const { data, error } = await supabase
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) throw error
  if (!data?.candidate) throw new Error('Application not found.')
  if (!data.job_posting_id || !data.job_posting) {
    throw new Error('Talent-pool applications can only be scored after matching them to a posting.')
  }

  return runApplicationScoring(data as RecruitmentApplication, data.candidate as RecruitmentCandidate, supabase, currentUserId)
}

// Deferred AI pass for a freshly created application (created with skipAi). Idempotent:
// only runs CV extraction when it has never been attempted, and scoring only while the
// application is still 'new' and unscored — so it is safe to call from both the intake
// route's after() hook and the recruitment-ai-sweep cron without double-processing.
export async function processRecruitmentApplicationAi(
  applicationId: string,
  supabase: GenericClient = createAdminClient()
): Promise<{
  application: RecruitmentApplication | null
  cvExtractionError: string | null
  scoringError: string | null
}> {
  const { data, error } = await supabase
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) throw error
  if (!data?.candidate) {
    return { application: null, cvExtractionError: null, scoringError: null }
  }

  const application = data as RecruitmentApplication
  let candidate = data.candidate as RecruitmentCandidate
  let cvExtractionError: string | null = null

  if (application.duplicate_of_application_id) {
    return { application, cvExtractionError: null, scoringError: null }
  }

  if (candidate.cv_text && !candidate.extracted_data) {
    const extraction = await extractRecruitmentCandidateFromCv(supabase, {
      candidateId: candidate.id,
      cvText: candidate.cv_text,
    })

    if (extraction.result) {
      const extracted = extraction.result
      const { data: updatedCandidate, error: candidateError } = await supabase
        .from('recruitment_candidates')
        .update({
          first_name: candidate.first_name ?? extracted.first_name,
          last_name: candidate.last_name ?? extracted.last_name,
          email: candidate.email ?? normalizeEmail(extracted.email),
          phone: candidate.phone ?? extracted.phone,
          location: candidate.location ?? extracted.location,
          cv_summary: extracted.experience_summary,
          extracted_data: extracted,
          cv_extraction_status: 'done',
        })
        .eq('id', candidate.id)
        .select('*')
        .single()

      if (!candidateError && updatedCandidate) {
        candidate = updatedCandidate as RecruitmentCandidate
      }
    } else if (extraction.error) {
      cvExtractionError = extraction.error
      await supabase
        .from('recruitment_candidates')
        .update({
          extracted_data: { extraction_error: extraction.error },
        })
        .eq('id', candidate.id)
    }
  }

  if (application.status !== 'new' || application.ai_score != null) {
    return { application, cvExtractionError, scoringError: null }
  }

  const scoring = await runApplicationScoring(application, candidate, supabase, null)
  return { application: scoring.application, cvExtractionError, scoringError: scoring.scoringError }
}

export async function matchRecruitmentCandidateToPosting(
  candidateId: string,
  jobPostingId: string,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
): Promise<{ application: RecruitmentApplication; duplicateOfApplicationId: string | null; scoringError: string | null }> {
  const [{ data: candidate, error: candidateError }, { data: posting, error: postingError }] = await Promise.all([
    supabase
      .from('recruitment_candidates')
      .select('*')
      .eq('id', candidateId)
      .maybeSingle(),
    supabase
      .from('recruitment_job_postings')
      .select('*')
      .eq('id', jobPostingId)
      .maybeSingle(),
  ])

  if (candidateError) throw candidateError
  if (postingError) throw postingError
  if (!candidate) throw new Error('Candidate not found.')
  if (!posting) throw new Error('Posting not found.')

  const { data: duplicate, error: duplicateError } = await supabase
    .from('recruitment_applications')
    .select('id')
    .eq('candidate_id', candidateId)
    .eq('job_posting_id', jobPostingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (duplicateError) throw duplicateError

  const duplicateOfApplicationId = duplicate?.id ?? null
  const { data: applicationData, error: applicationError } = await supabase
    .from('recruitment_applications')
    .insert({
      candidate_id: candidateId,
      job_posting_id: jobPostingId,
      status: duplicateOfApplicationId ? 'declined_duplicate' : 'new',
      source: 'manual_upload',
      duplicate_of_application_id: duplicateOfApplicationId,
      created_by: currentUserId ?? null,
    })
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .single()

  if (applicationError) throw applicationError

  let application = applicationData as RecruitmentApplication
  await insertStatusEvent(supabase, {
    applicationId: application.id,
    toStatus: application.status,
    changedBy: currentUserId ?? null,
    note: duplicateOfApplicationId ? 'Duplicate application for the same posting' : 'Candidate matched to posting',
    metadata: duplicateOfApplicationId ? { duplicate_of_application_id: duplicateOfApplicationId } : { matched_from_talent_pool: true },
  })

  if (duplicateOfApplicationId) {
    return { application, duplicateOfApplicationId, scoringError: null }
  }

  const scoring = await runApplicationScoring(application, candidate as RecruitmentCandidate, supabase, currentUserId)
  application = scoring.application
  return { application, duplicateOfApplicationId, scoringError: scoring.scoringError }
}

export async function createRecruitmentApplication(
  input: RecruitmentApplicationInput,
  options: {
    cvUpload?: RecruitmentCvUpload | null
    uploadKind?: 'public' | 'admin'
    currentUserId?: string | null
    skipAi?: boolean
  } = {},
  supabase: GenericClient = createAdminClient()
): Promise<{
  candidate: RecruitmentCandidate
  application: RecruitmentApplication
  duplicateOfApplicationId: string | null
  cvExtractionError: string | null
  scoringError: string | null
}> {
  const parsed = RecruitmentApplicationInputSchema.parse(input)
  const suppliedEmail = normalizeEmail(parsed.candidate.email)
  const consentAt = parsed.candidate.consent_at ?? new Date().toISOString()

  if (!suppliedEmail && !options.cvUpload) {
    throw new Error('Add an email address or upload a CV.')
  }

  let preParsedCv: ParsedRecruitmentCv | null = null
  let preExtraction: Awaited<ReturnType<typeof extractRecruitmentCandidateFromCv>> | null = null
  let cvExtractionError: string | null = null

  if (options.cvUpload) {
    const validationError = validateRecruitmentCvUpload(options.cvUpload, {
      maxBytes: getRecruitmentCvMaxBytes(options.uploadKind ?? 'admin'),
    })
    if (validationError) {
      throw new Error(validationError)
    }

    preParsedCv = await parseRecruitmentCv(options.cvUpload)
    if (preParsedCv.status === 'done' && preParsedCv.text && !options.skipAi) {
      preExtraction = await extractRecruitmentCandidateFromCv(supabase, {
        candidateId: null,
        cvText: preParsedCv.text,
      })
      if (preExtraction.error) {
        cvExtractionError = preExtraction.error
      }
    } else if (preParsedCv.status !== 'done') {
      cvExtractionError = preParsedCv.error
    }
  }

  const extracted = preExtraction?.result ?? null
  const candidateEmail = suppliedEmail ?? normalizeEmail(extracted?.email)

  let existingCandidate: RecruitmentCandidate | null = null
  if (candidateEmail) {
    const { data, error } = await supabase
      .from('recruitment_candidates')
      .select('*')
      .eq('email_normalized', candidateEmail)
      .is('anonymised_at', null)
      .maybeSingle()

    if (error) throw error
    existingCandidate = data as RecruitmentCandidate | null
  }

  const firstName = nullIfBlank(parsed.candidate.first_name) ?? nullIfBlank(extracted?.first_name)
  const lastName = nullIfBlank(parsed.candidate.last_name) ?? nullIfBlank(extracted?.last_name)
  const phone = nullIfBlank(parsed.candidate.phone) ?? nullIfBlank(extracted?.phone)
  const location = nullIfBlank(parsed.candidate.location) ?? nullIfBlank(extracted?.location)

  let candidate = existingCandidate
  if (!candidate) {
    const { data, error } = await supabase
      .from('recruitment_candidates')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: candidateEmail,
        phone,
        phone_e164: nullIfBlank(parsed.candidate.phone_e164),
        location,
        source: parsed.candidate.source,
        provided_details: nullIfBlank(parsed.candidate.provided_details),
        extracted_data: extracted,
        cv_summary: extracted?.experience_summary ?? null,
        consent_source: parsed.candidate.consent_source ?? parsed.source,
        consent_at: consentAt,
        privacy_notice_version: parsed.candidate.privacy_notice_version ?? null,
        sms_consent: parsed.candidate.sms_consent,
        sms_consent_at: parsed.candidate.sms_consent ? consentAt : null,
        future_recruitment_consent: parsed.candidate.future_recruitment_consent,
        future_recruitment_consent_at: parsed.candidate.future_recruitment_consent ? consentAt : null,
        notes: nullIfBlank(parsed.candidate.notes),
        retention_until: addMonths(new Date(consentAt), retentionMonths()).toISOString().slice(0, 10),
        created_by: options.currentUserId ?? null,
      })
      .select('*')
      .single()

    if (error) throw error
    candidate = data as RecruitmentCandidate
  } else {
    const { data, error } = await supabase
      .from('recruitment_candidates')
      .update({
        first_name: firstName ?? candidate.first_name,
        last_name: lastName ?? candidate.last_name,
        email: candidate.email ?? candidateEmail,
        phone: phone ?? candidate.phone,
        phone_e164: nullIfBlank(parsed.candidate.phone_e164) ?? candidate.phone_e164,
        location: location ?? candidate.location,
        provided_details: nullIfBlank(parsed.candidate.provided_details) ?? candidate.provided_details,
        extracted_data: extracted ?? candidate.extracted_data,
        cv_summary: extracted?.experience_summary ?? candidate.cv_summary,
        sms_consent: parsed.candidate.sms_consent || candidate.sms_consent,
        sms_consent_at: parsed.candidate.sms_consent ? consentAt : candidate.sms_consent_at,
        future_recruitment_consent: parsed.candidate.future_recruitment_consent || candidate.future_recruitment_consent,
        future_recruitment_consent_at: parsed.candidate.future_recruitment_consent
          ? consentAt
          : candidate.future_recruitment_consent_at,
        notes: nullIfBlank(parsed.candidate.notes) ?? candidate.notes,
      })
      .eq('id', candidate.id)
      .select('*')
      .single()

    if (error) throw error
    candidate = data as RecruitmentCandidate
  }

  if (preExtraction?.runId) {
    await supabase
      .from('recruitment_ai_runs')
      .update({ candidate_id: candidate.id })
      .eq('id', preExtraction.runId)
  }

  if (options.cvUpload) {
    try {
      const stored = await storeCvForCandidate(
        supabase,
        candidate.id,
        options.cvUpload,
        options.uploadKind ?? 'admin',
        preParsedCv
      )

      const { data, error } = await supabase
        .from('recruitment_candidates')
        .update({
          cv_file_path: stored.path,
          cv_file_name: options.cvUpload.fileName,
          cv_mime_type: options.cvUpload.mimeType,
          cv_file_size_bytes: options.cvUpload.sizeBytes,
          cv_text: stored.extractedText,
          cv_extraction_status: stored.extractionStatus,
        extracted_data: extracted ?? candidate.extracted_data ?? (stored.extractionError ? { extraction_error: stored.extractionError } : null),
        cv_summary: extracted?.experience_summary ?? candidate.cv_summary,
      })
      .eq('id', candidate.id)
      .select('*')
        .single()

      if (error) throw error
      candidate = data as RecruitmentCandidate
      cvExtractionError = cvExtractionError ?? stored.extractionError
    } catch (error) {
      if (!isInfrastructureStorageError(error)) {
        throw error
      }
      if ((options.uploadKind ?? 'admin') === 'public') {
        throw error
      }
      cvExtractionError = error instanceof Error ? error.message : 'CV handling failed'
    }
  }

  let duplicateOfApplicationId: string | null = null
  if (parsed.job_posting_id) {
    const { data: duplicate, error: duplicateError } = await supabase
      .from('recruitment_applications')
      .select('id')
      .eq('candidate_id', candidate.id)
      .eq('job_posting_id', parsed.job_posting_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (duplicateError) throw duplicateError
    duplicateOfApplicationId = duplicate?.id ?? null
  }

  const initialStatus = duplicateOfApplicationId ? 'declined_duplicate' : 'new'
  const { data: applicationData, error: applicationError } = await supabase
    .from('recruitment_applications')
    .insert({
      candidate_id: candidate.id,
      job_posting_id: parsed.job_posting_id ?? null,
      status: initialStatus,
      source: parsed.source,
      availability: parsed.availability ?? null,
      cover_note: nullIfBlank(parsed.cover_note),
      relevant_experience_answer: nullIfBlank(parsed.relevant_experience_answer),
      travel_answer: nullIfBlank(parsed.travel_answer),
      start_availability: nullIfBlank(parsed.start_availability),
      duplicate_of_application_id: duplicateOfApplicationId,
      created_by: options.currentUserId ?? null,
    })
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .single()

  if (applicationError) throw applicationError

  let application = applicationData as RecruitmentApplication
  await insertStatusEvent(supabase, {
    applicationId: application.id,
    toStatus: initialStatus,
    changedBy: options.currentUserId ?? null,
    note: duplicateOfApplicationId ? 'Duplicate application for the same posting' : 'Application created',
    metadata: duplicateOfApplicationId ? { duplicate_of_application_id: duplicateOfApplicationId } : null,
  })

  if (duplicateOfApplicationId) {
    return { candidate, application, duplicateOfApplicationId, cvExtractionError, scoringError: null }
  }

  if (!options.skipAi && candidate.cv_text && !preExtraction?.result) {
    const extraction = await extractRecruitmentCandidateFromCv(supabase, {
      candidateId: candidate.id,
      cvText: candidate.cv_text,
    })

    if (extraction.result) {
      const extracted = extraction.result
      const { data, error } = await supabase
        .from('recruitment_candidates')
        .update({
          first_name: candidate.first_name ?? extracted.first_name,
          last_name: candidate.last_name ?? extracted.last_name,
          email: candidate.email ?? normalizeEmail(extracted.email),
          phone: candidate.phone ?? extracted.phone,
          location: candidate.location ?? extracted.location,
          cv_summary: extracted.experience_summary,
          extracted_data: extracted,
          cv_extraction_status: 'done',
        })
        .eq('id', candidate.id)
        .select('*')
        .single()

      if (!error && data) {
        candidate = data as RecruitmentCandidate
      }
    } else if (extraction.error) {
      cvExtractionError = extraction.error
      await supabase
        .from('recruitment_candidates')
        .update({
          extracted_data: {
            extraction_error: extraction.error,
          },
        })
        .eq('id', candidate.id)
    }
  }

  let scoringError: string | null = null
  if (!options.skipAi && parsed.job_posting_id && application.job_posting) {
    const scoring = await scoreRecruitmentApplication(supabase, {
      applicationId: application.id,
      candidateId: candidate.id,
      jobPostingId: parsed.job_posting_id,
      posting: {
        title: application.job_posting.title,
        requirements: application.job_posting.requirements,
        ai_scoring_notes: application.job_posting.ai_scoring_notes,
        role_type: application.job_posting.role_type,
        version: application.job_posting.version,
      },
      candidateText: [
        ...candidateAiContext(candidate),
        parsed.cover_note,
        parsed.relevant_experience_answer,
        parsed.travel_answer,
        parsed.start_availability,
      ].filter(Boolean).join('\n\n'),
      availability: parsed.availability ?? null,
      coverNote: parsed.cover_note ?? null,
      relevantExperience: parsed.relevant_experience_answer ?? null,
      travel: parsed.travel_answer ?? null,
      startAvailability: parsed.start_availability ?? null,
    })

    if (scoring.result) {
      const result = scoring.result
      const { data, error } = await supabase
        .from('recruitment_applications')
        .update({
          status: 'ai_screened',
          ai_score: result.score,
          ai_recommendation: result.recommendation,
          ai_rationale: result.rationale,
          ai_strengths: result.strengths,
          ai_concerns: result.concerns,
          ai_flags: result.flags,
          latest_ai_run_id: scoring.runId,
          ai_scored_at: new Date().toISOString(),
          ai_scored_against_version: application.job_posting?.version ?? null,
        })
        .eq('id', application.id)
        .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
        .single()

      if (!error && data) {
        await insertStatusEvent(supabase, {
          applicationId: application.id,
          fromStatus: application.status,
          toStatus: 'ai_screened',
          changedBy: options.currentUserId ?? null,
          note: 'AI screen completed',
          metadata: { run_id: scoring.runId },
        })
        application = data as RecruitmentApplication
      }
    } else {
      scoringError = scoring.error ?? 'AI scoring failed'
    }
  }

  return { candidate, application, duplicateOfApplicationId, cvExtractionError, scoringError }
}

export async function transitionRecruitmentApplicationStatus(
  applicationId: string,
  status: string,
  options: {
    note?: string | null
    metadata?: Record<string, unknown> | null
  } = {},
  supabase: GenericClient = createAdminClient()
) {
  const { data, error } = await supabase.rpc('recruitment_transition_application_status', {
    p_application_id: applicationId,
    p_to_status: status,
    p_note: options.note ?? null,
    p_metadata: options.metadata ?? {},
  })

  if (error) throw error
  return data as RecruitmentApplication
}

export async function createRecruitmentAppointmentSlot(
  input: unknown,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
) {
  const parsed = RecruitmentAppointmentSlotInputSchema.parse(input)
  const startsAt = new Date(parsed.starts_at)
  const endsAt = new Date(parsed.ends_at)

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error('Appointment slot must have a valid start and end time.')
  }

  const { data, error } = await supabase
    .from('recruitment_appointment_slots')
    .insert({
      ...parsed,
      created_by: currentUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as RecruitmentAppointmentSlotInput & { id: string; status: string }
}

export async function recordRecruitmentAppointmentOutcome(
  appointmentId: string,
  input: RecruitmentAppointmentOutcomeInput,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
) {
  const parsed = RecruitmentAppointmentOutcomeInputSchema.parse(input)
  const { data: appointment, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) throw error
  if (!appointment) throw new Error('Appointment not found.')

  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('recruitment_candidate_appointments')
    .update({
      status: parsed.status,
      outcome: nullIfBlank(parsed.outcome),
      outcome_rating: parsed.outcome_rating ?? null,
      meal_provided: parsed.meal_provided,
      outcome_recorded_at: parsed.status === 'scheduled' ? null : nowIso,
    })
    .eq('id', appointmentId)
    .select('*')
    .single()

  if (updateError) throw updateError

  if (parsed.status === 'completed') {
    await transitionRecruitmentApplicationStatus(appointment.application_id, appointment.type === 'trial_shift' ? 'trial_completed' : 'interviewed', {
      note: `${appointment.type === 'trial_shift' ? 'Trial shift' : 'Interview'} completed`,
      metadata: { appointment_id: appointmentId, outcome_rating: parsed.outcome_rating ?? null },
    }, supabase)
  } else if (parsed.status === 'no_show') {
    await transitionRecruitmentApplicationStatus(appointment.application_id, 'on_hold', {
      note: 'Candidate did not attend appointment',
      metadata: { appointment_id: appointmentId, no_show: true },
    }, supabase)
  } else if (parsed.status === 'cancelled' && appointment.slot_id) {
    await supabase
      .from('recruitment_appointment_slots')
      .update({ status: 'open' })
      .eq('id', appointment.slot_id)
  }

  if (parsed.status !== 'scheduled') {
    await insertStatusEvent(supabase, {
      applicationId: appointment.application_id,
      fromStatus: null,
      toStatus: parsed.status,
      changedBy: currentUserId ?? null,
      note: parsed.outcome ?? `Appointment marked ${parsed.status}`,
      metadata: { appointment_id: appointmentId, appointment_status: parsed.status },
    })
  }

  return updated
}

export async function issueRecruitmentBookingLink(
  applicationId: string,
  type: RecruitmentAppointmentType,
  options: { expiresInDays?: number; note?: string | null } = {},
  supabase: GenericClient = createAdminClient()
) {
  const token = createToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + (options.expiresInDays ?? 14) * 24 * 60 * 60 * 1000).toISOString()
  const nextStatus = type === 'trial_shift' ? 'trial_offered' : 'interview_invited'

  const { error } = await supabase
    .from('recruitment_applications')
    .update({
      booking_token_hash: tokenHash,
      booking_token_type: type,
      booking_token_expires_at: expiresAt,
      booking_token_used_at: null,
    })
    .eq('id', applicationId)

  if (error) throw error

  await transitionRecruitmentApplicationStatus(applicationId, nextStatus, {
    note: options.note ?? 'Booking link issued',
    metadata: { appointment_type: type },
  }, supabase)

  return {
    token,
    tokenHash,
    expiresAt,
    bookingUrl: `${recruitmentBaseUrl()}/recruitment/book/${token}`,
  }
}

export async function previewRecruitmentBookingToken(
  token: string,
  supabase: GenericClient = createAdminClient()
) {
  const tokenHash = hashToken(token)
  const nowIso = new Date().toISOString()

  const { data: application, error } = await supabase
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(id, first_name, last_name, email), job_posting:recruitment_job_postings(id, title)')
    .eq('booking_token_hash', tokenHash)
    .gt('booking_token_expires_at', nowIso)
    .maybeSingle()

  if (error) throw error
  if (!application) {
    return { valid: false as const, application: null, slots: [] }
  }

  const { data: currentAppointment, error: appointmentError } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('booking_token_hash', tokenHash)
    .in('status', ['scheduled', 'cancelled', 'rescheduled'])
    .order('scheduled_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (appointmentError) throw appointmentError

  const { data: slots, error: slotError } = await supabase
    .from('recruitment_appointment_slots')
    .select('*')
    .eq('type', application.booking_token_type)
    .eq('status', 'open')
    .gt('starts_at', nowIso)
    .order('starts_at', { ascending: true })
    .limit(50)

  if (slotError) throw slotError

  return {
    valid: true as const,
    application,
    alreadyBooked: Boolean(application.booking_token_used_at),
    currentAppointment: currentAppointment ?? null,
    slots: slots ?? [],
  }
}

export async function claimRecruitmentAppointmentSlot(
  token: string,
  slotId: string,
  supabase: GenericClient = createAdminClient()
) {
  const tokenHash = hashToken(token)
  const preview = await previewRecruitmentBookingToken(token, supabase)
  if (!preview.valid || !preview.application) {
    throw new Error('Booking link is invalid or expired.')
  }
  if (preview.application.booking_token_used_at) {
    throw new Error('This booking link has already been used.')
  }

  const expiresAt = preview.application.booking_token_expires_at
  const { data: appointmentId, error } = await supabase.rpc('recruitment_claim_appointment_slot', {
    p_slot_id: slotId,
    p_application_id: preview.application.id,
    p_candidate_id: preview.application.candidate_id,
    p_booking_token_hash: tokenHash,
    p_token_expires_at: expiresAt,
  })

  if (error) throw error

  await supabase
    .from('recruitment_applications')
    .update({ booking_token_used_at: new Date().toISOString() })
    .eq('id', preview.application.id)

  return appointmentId as string
}

export async function cancelRecruitmentAppointment(
  token: string,
  supabase: GenericClient = createAdminClient()
) {
  const tokenHash = hashToken(token)
  const { data: appointment, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('booking_token_hash', tokenHash)
    .eq('status', 'scheduled')
    .order('scheduled_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!appointment) throw new Error('Appointment not found.')
  if (new Date(appointment.scheduled_start) <= new Date()) {
    throw new Error('This appointment can no longer be changed online.')
  }

  const { error: updateError } = await supabase
    .from('recruitment_candidate_appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointment.id)

  if (updateError) throw updateError

  if (appointment.slot_id) {
    await supabase
      .from('recruitment_appointment_slots')
      .update({ status: 'open' })
      .eq('id', appointment.slot_id)
  }

  await transitionRecruitmentApplicationStatus(appointment.application_id, 'on_hold', {
    note: 'Candidate cancelled appointment',
    metadata: { appointment_id: appointment.id },
  }, supabase)

  return {
    success: true,
    appointmentId: appointment.id,
    applicationId: appointment.application_id,
    candidateId: appointment.candidate_id,
    slotId: appointment.slot_id ?? null,
  }
}

export async function rescheduleRecruitmentAppointment(
  token: string,
  newSlotId: string,
  supabase: GenericClient = createAdminClient()
) {
  const tokenHash = hashToken(token)
  const { data: appointment, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('booking_token_hash', tokenHash)
    .eq('status', 'scheduled')
    .order('scheduled_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!appointment) throw new Error('Appointment not found.')
  if (new Date(appointment.scheduled_start) <= new Date()) {
    throw new Error('This appointment can no longer be changed online.')
  }
  if (Number(appointment.reschedule_count ?? 0) >= 1) {
    throw new Error('This appointment has already been rescheduled once.')
  }

  const { data: newSlot, error: slotError } = await supabase
    .from('recruitment_appointment_slots')
    .update({ status: 'booked' })
    .eq('id', newSlotId)
    .eq('status', 'open')
    .gt('starts_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (slotError) throw slotError
  if (!newSlot) throw new Error('Slot is no longer available.')

  const { error: updateError } = await supabase
    .from('recruitment_candidate_appointments')
    .update({
      slot_id: newSlot.id,
      scheduled_start: newSlot.starts_at,
      scheduled_end: newSlot.ends_at,
      timezone: newSlot.timezone,
      location: newSlot.location,
      supervisor_staff_id: newSlot.supervisor_staff_id,
      status: 'scheduled',
      calendar_sync_status: 'pending',
      calendar_last_error: null,
      reschedule_count: Number(appointment.reschedule_count ?? 0) + 1,
    })
    .eq('id', appointment.id)

  if (updateError) throw updateError

  if (appointment.slot_id) {
    await supabase
      .from('recruitment_appointment_slots')
      .update({ status: 'open' })
      .eq('id', appointment.slot_id)
  }

  await insertStatusEvent(supabase, {
    applicationId: appointment.application_id,
    fromStatus: null,
    toStatus: appointment.type === 'trial_shift' ? 'trial_scheduled' : 'interview_scheduled',
    note: 'Candidate rescheduled appointment',
    metadata: { appointment_id: appointment.id, old_slot_id: appointment.slot_id, new_slot_id: newSlot.id },
  })

  return { success: true, appointmentId: appointment.id }
}

export async function getRecruitmentCvSignedUrl(
  candidateId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data: candidate, error } = await supabase
    .from('recruitment_candidates')
    .select('cv_file_path')
    .eq('id', candidateId)
    .maybeSingle()

  if (error) throw error
  if (!candidate?.cv_file_path) return null

  const { data, error: signedError } = await supabase.storage
    .from(RECRUITMENT_CV_BUCKET)
    .createSignedUrl(candidate.cv_file_path, 60 * 10)

  if (signedError) throw signedError
  return data.signedUrl
}

export async function copyRecruitmentCvToEmployee(
  candidateId: string,
  employeeId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data: candidate, error: candidateError } = await supabase
    .from('recruitment_candidates')
    .select('cv_file_path, cv_file_name, cv_mime_type, cv_file_size_bytes')
    .eq('id', candidateId)
    .maybeSingle()

  if (candidateError) throw candidateError
  if (!candidate?.cv_file_path) return { copied: false, reason: 'no_cv' }

  const { data: category, error: categoryError } = await supabase
    .from('attachment_categories')
    .select('category_id')
    .ilike('category_name', 'CV')
    .maybeSingle()

  if (categoryError) throw categoryError
  if (!category?.category_id) return { copied: false, reason: 'missing_cv_category' }

  const { data: file, error: downloadError } = await supabase.storage
    .from(RECRUITMENT_CV_BUCKET)
    .download(candidate.cv_file_path)

  if (downloadError) throw downloadError

  const fileName = candidate.cv_file_name || 'candidate-cv'
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : ''
  const destinationPath = `${employeeId}/${Date.now()}_candidate_cv${extension}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { data: upload, error: uploadError } = await supabase.storage
    .from('employee-attachments')
    .upload(destinationPath, buffer, {
      contentType: candidate.cv_mime_type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) throw uploadError

  const { error: insertError } = await supabase.from('employee_attachments').insert({
    employee_id: employeeId,
    category_id: category.category_id,
    file_name: fileName,
    storage_path: upload?.path ?? destinationPath,
    mime_type: candidate.cv_mime_type || 'application/octet-stream',
    file_size_bytes: candidate.cv_file_size_bytes ?? buffer.byteLength,
    description: 'Copied from recruitment candidate CV',
  })

  if (insertError) {
    await supabase.storage.from('employee-attachments').remove([upload?.path ?? destinationPath])
    throw insertError
  }

  return { copied: true, storagePath: upload?.path ?? destinationPath }
}

export async function completeRecruitmentHireHandoff(
  applicationId: string,
  employeeId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data: application, error } = await supabase
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(*)')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) throw error
  if (!application?.candidate) throw new Error('Recruitment application not found.')

  await copyRecruitmentCvToEmployee(application.candidate_id, employeeId, supabase)

  const candidate = application.candidate as any
  if (
    candidate.right_to_work_status === 'verified' &&
    candidate.right_to_work_document_type &&
    candidate.right_to_work_checked_at
  ) {
    await supabase.from('employee_right_to_work').upsert({
      employee_id: employeeId,
      document_type: candidate.right_to_work_document_type,
      verification_date: String(candidate.right_to_work_checked_at).slice(0, 10),
      verified_by_user_id: candidate.right_to_work_checked_by ?? null,
      check_method: 'recruitment_handoff',
      document_details: 'Seeded from verified recruitment candidate record',
    })
  }

  const { error: candidateError } = await supabase
    .from('recruitment_candidates')
    .update({ converted_employee_id: employeeId })
    .eq('id', application.candidate_id)

  if (candidateError) throw candidateError

  await transitionRecruitmentApplicationStatus(applicationId, 'hired', {
    note: 'Candidate converted to employee',
    metadata: { employee_id: employeeId },
  }, supabase)

  return { success: true }
}

export async function runRecruitmentRetentionCleanup(
  supabase: GenericClient = createAdminClient()
) {
  const cutoffIso = addMonths(new Date(), -retentionMonths()).toISOString()
  const { data: applications, error } = await supabase
    .from('recruitment_applications')
    .select('id, candidate_id, status, created_at, candidate:recruitment_candidates(*)')
    .in('status', TERMINAL_NON_HIRED_STATUSES as unknown as string[])
    .lt('created_at', cutoffIso)
    .is('candidate.anonymised_at', null)
    .limit(100)

  if (error) throw error

  let anonymised = 0
  let cvDeleted = 0
  for (const application of applications ?? []) {
    const candidate = application.candidate as any
    if (!candidate?.id || candidate.converted_employee_id) continue

    if (candidate.cv_file_path) {
      const { error: removeError } = await supabase.storage
        .from(RECRUITMENT_CV_BUCKET)
        .remove([candidate.cv_file_path])
      if (!removeError) cvDeleted += 1
    }

    const { error: updateError } = await supabase
      .from('recruitment_candidates')
      .update({
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        phone_e164: null,
        location: null,
        cv_file_path: null,
        cv_file_name: null,
        cv_mime_type: null,
        cv_file_size_bytes: null,
        cv_text: null,
        provided_details: null,
        extracted_data: null,
        cv_summary: null,
        notes: null,
        sms_consent: false,
        future_recruitment_consent: false,
        anonymised_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)

    if (updateError) throw updateError

    await supabase
      .from('recruitment_communications')
      .update({
        final_body: '[anonymised after recruitment retention period]',
        subject: null,
      })
      .eq('candidate_id', candidate.id)

    anonymised += 1
  }

  return { anonymised, cvDeleted }
}

export async function eraseRecruitmentCandidate(
  candidateId: string,
  reason: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data: candidate, error } = await supabase
    .from('recruitment_candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle()

  if (error) throw error
  if (!candidate) throw new Error('Candidate not found.')

  const nowIso = new Date().toISOString()
  const { data: futureAppointments, error: appointmentError } = await supabase
    .from('recruitment_candidate_appointments')
    .select('id, slot_id')
    .eq('candidate_id', candidateId)
    .eq('status', 'scheduled')
    .gt('scheduled_start', nowIso)

  if (appointmentError) throw appointmentError

  for (const appointment of futureAppointments ?? []) {
    await supabase
      .from('recruitment_candidate_appointments')
      .update({ status: 'cancelled', calendar_sync_status: 'pending', calendar_last_error: 'Cancelled by GDPR erasure' })
      .eq('id', appointment.id)

    if (appointment.slot_id) {
      await supabase
        .from('recruitment_appointment_slots')
        .update({ status: 'open' })
        .eq('id', appointment.slot_id)
    }
  }

  if (candidate.cv_file_path) {
    await supabase.storage.from(RECRUITMENT_CV_BUCKET).remove([candidate.cv_file_path])
  }

  const { error: updateError } = await supabase
    .from('recruitment_candidates')
    .update({
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      phone_e164: null,
      location: null,
      cv_file_path: null,
      cv_file_name: null,
      cv_mime_type: null,
      cv_file_size_bytes: null,
      cv_text: null,
      provided_details: null,
      extracted_data: null,
      cv_summary: null,
      notes: null,
      sms_consent: false,
      sms_consent_at: null,
      future_recruitment_consent: false,
      future_recruitment_consent_at: null,
      anonymised_at: nowIso,
    })
    .eq('id', candidateId)

  if (updateError) throw updateError

  await supabase
    .from('recruitment_communications')
    .update({
      final_body: '[erased under GDPR request]',
      subject: null,
      metadata: { erasure_reason: reason, erased_at: nowIso },
    })
    .eq('candidate_id', candidateId)

  return { success: true, cancelledAppointments: futureAppointments?.length ?? 0 }
}

export function formatRecruitmentAppointment(appointment: {
  scheduled_start: string
  timezone?: string | null
  type?: string | null
}) {
  const date = new Date(appointment.scheduled_start)
  const label = appointment.type === 'trial_shift' ? 'trial shift' : 'interview'
  const time = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: appointment.timezone || 'Europe/London',
  }).format(date)
  return `${label} on ${time}`
}

export function buildRecruitmentPrintableKit(input: {
  application: any
  appointment?: any
  kind: 'interview' | 'trial'
}) {
  const candidate = input.application.candidate ?? {}
  const posting = input.application.job_posting ?? {}
  const name = candidateName(candidate)

  if (input.kind === 'trial') {
    return [
      `Trial brief: ${name}`,
      `Role: ${posting.title ?? 'General recruitment'}`,
      `When: ${input.appointment ? formatRecruitmentAppointment(input.appointment) : 'To be confirmed'}`,
      'Trial: short unpaid practical trial, paired with an existing team member.',
      'Food: complimentary main-menu item and soft drink after the trial.',
      'Right to work: check original/valid proof before any work-like duties begin.',
      'Decision notes:',
      '',
    ].join('\n')
  }

  return [
    `Interview kit: ${name}`,
    `Role: ${posting.title ?? 'General recruitment'}`,
    `When: ${input.appointment ? formatRecruitmentAppointment(input.appointment) : 'To be confirmed'}`,
    `AI score: ${input.application.ai_score ?? 'Not scored'}`,
    `Recommendation: ${input.application.ai_recommendation ?? 'Manual review'}`,
    'Right to work: remind candidate to bring proof.',
    'Questions:',
    '1. Relevant pub/hospitality experience',
    '2. Availability and travel reliability',
    '3. Customer handling and pressure examples',
    'Decision notes:',
    '',
  ].join('\n')
}
