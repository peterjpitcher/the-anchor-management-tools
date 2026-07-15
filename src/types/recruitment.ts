import { z } from 'zod'

const recruitmentRoleTypes = ['bar', 'kitchen', 'either', 'management', 'other'] as const
const recruitmentEmploymentTypes = ['full_time', 'part_time', 'casual'] as const
const recruitmentPostingStatuses = ['draft', 'open', 'closed', 'archived'] as const
const recruitmentSources = ['website', 'manual_upload', 'referral', 'job_board', 'other'] as const
const recruitmentApplicationStatuses = [
  'new',
  'ai_screened',
  'shortlisted',
  'interview_invited',
  'interview_scheduled',
  'interviewed',
  'trial_offered',
  'trial_scheduled',
  'trial_completed',
  'offered',
  'hired',
  'talent_pool',
  'rejected',
  'withdrawn',
  'on_hold',
  'declined_duplicate',
] as const
const recruitmentRecommendations = ['reject', 'review', 'fast_track'] as const
const recruitmentAppointmentTypes = ['interview', 'trial_shift'] as const
const recruitmentAppointmentStatuses = ['scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled'] as const
const recruitmentCalendarStatuses = ['pending', 'synced', 'failed', 'ics_fallback'] as const
const recruitmentCommunicationChannels = ['email', 'sms'] as const
const recruitmentDeliveryStatuses = ['queued', 'sent', 'failed', 'bounced', 'suppressed'] as const
const recruitmentTemplateTypes = [
  'interview_invite',
  'concerns_follow_up',
  'rejection',
  'already_considered',
  'trial_invite',
  'offer',
  'interview_confirmation',
  'trial_confirmation',
  'reminder',
  'manager_alert',
] as const
const recruitmentScorecardRecommendations = ['hire', 'hold', 'reject', 'rebook', 'no_decision'] as const
const rightToWorkDocumentTypes = ['Passport', 'Biometric Residence Permit', 'Share Code', 'Other', 'List A', 'List B'] as const

type RecruitmentRoleType = typeof recruitmentRoleTypes[number]
type RecruitmentEmploymentType = typeof recruitmentEmploymentTypes[number]
type RecruitmentPostingStatus = typeof recruitmentPostingStatuses[number]
export type RecruitmentSource = typeof recruitmentSources[number]
type RecruitmentApplicationStatus = typeof recruitmentApplicationStatuses[number]
type RecruitmentRecommendation = typeof recruitmentRecommendations[number]
export type RecruitmentAppointmentType = typeof recruitmentAppointmentTypes[number]
type RecruitmentAppointmentStatus = typeof recruitmentAppointmentStatuses[number]
export type RecruitmentTemplateType = typeof recruitmentTemplateTypes[number]
type RecruitmentScorecardRecommendation = typeof recruitmentScorecardRecommendations[number]

export const RecruitmentJobPostingInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  role_type: z.enum(recruitmentRoleTypes),
  description: z.string().trim().min(1).max(12000),
  requirements: z.string().trim().min(1).max(12000),
  ai_scoring_notes: z.string().trim().max(4000).nullable().optional(),
  employment_type: z.enum(recruitmentEmploymentTypes),
  positions_available: z.coerce.number().int().min(1).max(100).default(1),
  status: z.enum(recruitmentPostingStatuses).default('draft'),
  is_public: z.coerce.boolean().default(false),
  application_closing_date: z.string().date().nullable().optional(),
})

const RecruitmentCandidateInputSchema = z.object({
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  phone_e164: z.string().trim().max(32).nullable().optional(),
  location: z.string().trim().max(255).nullable().optional(),
  source: z.enum(recruitmentSources).default('manual_upload'),
  provided_details: z.string().trim().max(20000).nullable().optional(),
  consent_source: z.string().trim().max(120).nullable().optional(),
  consent_at: z.string().datetime().nullable().optional(),
  privacy_notice_version: z.string().trim().max(80).nullable().optional(),
  sms_consent: z.coerce.boolean().default(false),
  future_recruitment_consent: z.coerce.boolean().default(false),
  notes: z.string().trim().max(10000).nullable().optional(),
})

export const RecruitmentApplicationInputSchema = z.object({
  candidate: RecruitmentCandidateInputSchema,
  job_posting_id: z.string().uuid().nullable().optional(),
  source: z.enum(recruitmentSources).default('manual_upload'),
  availability: z.unknown().nullable().optional(),
  cover_note: z.string().trim().max(12000).nullable().optional(),
  relevant_experience_answer: z.string().trim().max(4000).nullable().optional(),
  travel_answer: z.string().trim().max(4000).nullable().optional(),
  start_availability: z.string().trim().max(255).nullable().optional(),
})

export const RecruitmentAppointmentSlotInputSchema = z.object({
  type: z.enum(recruitmentAppointmentTypes),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  timezone: z.string().trim().default('Europe/London'),
  location: z.string().trim().min(1).max(255).default('The Anchor'),
  interviewer_user_id: z.string().uuid().nullable().optional(),
  supervisor_staff_id: z.string().uuid().nullable().optional(),
})

export const RecruitmentCandidateProfileInputSchema = z.object({
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  phone_e164: z.string().trim().max(32).nullable().optional(),
  location: z.string().trim().max(255).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  sms_consent: z.coerce.boolean().optional(),
  future_recruitment_consent: z.coerce.boolean().optional(),
  right_to_work_status: z.enum(['not_checked', 'pending', 'verified', 'failed']).optional(),
  right_to_work_document_type: z.enum(rightToWorkDocumentTypes).nullable().optional(),
  right_to_work_checked_at: z.string().datetime().nullable().optional(),
})

export const RecruitmentAppointmentOutcomeInputSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']),
  outcome: z.string().trim().max(10000).nullable().optional(),
  outcome_rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  meal_provided: z.coerce.boolean().default(false),
})

export const RecruitmentInterviewScorecardInputSchema = z.object({
  appointment_id: z.string().uuid(),
  comments: z.string().trim().max(10000).nullable().optional(),
  overall_rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  recommendation: z.enum(recruitmentScorecardRecommendations).default('no_decision'),
  criteria: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })).default([]),
})

type RecruitmentJobPostingInput = z.infer<typeof RecruitmentJobPostingInputSchema>
export type RecruitmentApplicationInput = z.infer<typeof RecruitmentApplicationInputSchema>
type RecruitmentCandidateInput = z.infer<typeof RecruitmentCandidateInputSchema>
export type RecruitmentAppointmentSlotInput = z.infer<typeof RecruitmentAppointmentSlotInputSchema>
export type RecruitmentCandidateProfileInput = z.infer<typeof RecruitmentCandidateProfileInputSchema>
export type RecruitmentAppointmentOutcomeInput = z.infer<typeof RecruitmentAppointmentOutcomeInputSchema>
export type RecruitmentInterviewScorecardInput = z.infer<typeof RecruitmentInterviewScorecardInputSchema>

export type RecruitmentCvUpload = {
  buffer: Buffer
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type RecruitmentCandidate = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  phone_e164: string | null
  location: string | null
  source: RecruitmentSource
  cv_file_path: string | null
  cv_file_name: string | null
  cv_mime_type: string | null
  cv_file_size_bytes: number | null
  cv_sha256: string | null
  cv_text: string | null
  cv_extraction_status: string
  extracted_data?: unknown | null
  provided_details: string | null
  cv_summary?: string | null
  right_to_work_status?: 'not_checked' | 'pending' | 'verified' | 'failed'
  right_to_work_document_type?: typeof rightToWorkDocumentTypes[number] | null
  right_to_work_checked_at?: string | null
  right_to_work_checked_by?: string | null
  sms_consent: boolean
  sms_consent_at?: string | null
  future_recruitment_consent: boolean
  future_recruitment_consent_at?: string | null
  anonymised_at: string | null
  converted_employee_id: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

export type RecruitmentJobPosting = RecruitmentJobPostingInput & {
  id: string
  version: number
  opened_at: string | null
  closed_at: string | null
  application_closing_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RecruitmentApplication = {
  id: string
  candidate_id: string
  job_posting_id: string | null
  status: RecruitmentApplicationStatus
  source: RecruitmentSource
  availability: unknown | null
  cover_note: string | null
  relevant_experience_answer: string | null
  travel_answer: string | null
  start_availability: string | null
  ai_score: number | null
  ai_recommendation: RecruitmentRecommendation | null
  ai_rationale: string | null
  ai_strengths: unknown | null
  ai_concerns: unknown | null
  ai_flags: unknown | null
  ai_model: string | null
  ai_scored_at: string | null
  ai_scored_against_version: number | null
  booking_token_hash?: string | null
  booking_token_type?: RecruitmentAppointmentType | null
  booking_token_expires_at?: string | null
  booking_token_used_at?: string | null
  rejected_at: string | null
  rejection_reason?: string | null
  duplicate_of_application_id: string | null
  archived_at?: string | null
  archived_by?: string | null
  created_at: string
  updated_at: string
  candidate?: RecruitmentCandidate
  job_posting?: RecruitmentJobPosting | null
}

type RecruitmentAppointmentSlot = RecruitmentAppointmentSlotInput & {
  id: string
  status: 'open' | 'booked' | 'cancelled'
  capacity: number
  archived_at?: string | null
  archived_by?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentCandidateAppointment = {
  id: string
  application_id: string
  candidate_id: string
  slot_id: string | null
  type: RecruitmentAppointmentType
  scheduled_start: string
  scheduled_end: string
  timezone: string
  location: string
  supervisor_staff_id: string | null
  status: RecruitmentAppointmentStatus
  calendar_event_id: string | null
  calendar_sync_status: string
  calendar_last_error: string | null
  booking_token_hash: string | null
  token_expires_at: string | null
  reschedule_count: number
  reminder_email_sent_at: string | null
  reminder_sms_sent_at: string | null
  outcome: string | null
  outcome_rating: number | null
  meal_provided: boolean
  outcome_recorded_at: string | null
  archived_at?: string | null
  archived_by?: string | null
  created_at: string
  updated_at: string
  candidate?: Pick<RecruitmentCandidate, 'first_name' | 'last_name' | 'email'>
  application?: Pick<RecruitmentApplication, 'id' | 'status'> & { job_posting?: Pick<RecruitmentJobPosting, 'title'> | null }
}

type RecruitmentInterviewScorecard = {
  id: string
  appointment_id: string
  application_id: string
  candidate_id: string
  criteria: unknown
  overall_rating: number | null
  recommendation: RecruitmentScorecardRecommendation
  comments: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RecruitmentEmailTemplate = {
  id: string
  type: RecruitmentTemplateType
  subject: string
  body: string
  is_active: boolean
  updated_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentCommunication = {
  id: string
  application_id: string | null
  candidate_id: string
  type: string
  channel: 'email' | 'sms'
  subject: string | null
  final_body: string
  was_ai_assisted: boolean
  ai_run_id: string | null
  edited_by: string | null
  sent_by: string | null
  sent_at: string | null
  delivery_status: 'queued' | 'sent' | 'failed' | 'bounced' | 'suppressed'
  provider: string | null
  provider_message_id: string | null
  idempotency_key: string | null
  metadata: unknown | null
  created_at: string
  updated_at: string
}

export type RecruitmentDashboard = {
  counts: {
    newApplications: number
    fastTrack: number
    manualReview: number
    awaitingBooking: number
    upcomingAppointments: number
    offers: number
    retentionDue: number
  }
  recentApplications: RecruitmentApplication[]
  upcomingAppointments: Array<Record<string, unknown>>
  actionItems: Array<{ id: string; label: string; count: number; href: string }>
}
