import type { Json } from './database.generated'

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type RecruitmentJobPostingRow = {
  id: string
  title: string
  slug: string
  role_type: string
  description: string
  requirements: string
  ai_scoring_notes: string | null
  employment_type: string
  positions_available: number
  status: string
  is_public: boolean
  version: number
  opened_at: string | null
  closed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentCandidateRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  email_normalized: string | null
  phone: string | null
  phone_e164: string | null
  location: string | null
  source: string
  cv_file_path: string | null
  cv_file_name: string | null
  cv_mime_type: string | null
  cv_file_size_bytes: number | null
  cv_sha256: string | null
  cv_text: string | null
  cv_extraction_status: string
  provided_details: string | null
  extracted_data: Json | null
  cv_summary: string | null
  right_to_work_status: string
  right_to_work_document_type: string | null
  right_to_work_checked_at: string | null
  right_to_work_checked_by: string | null
  consent_source: string | null
  consent_at: string | null
  privacy_notice_version: string | null
  sms_consent: boolean
  sms_consent_at: string | null
  future_recruitment_consent: boolean
  future_recruitment_consent_at: string | null
  retention_until: string | null
  anonymised_at: string | null
  converted_employee_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentApplicationRow = {
  id: string
  candidate_id: string
  job_posting_id: string | null
  is_general: boolean
  status: string
  source: string
  availability: Json | null
  cover_note: string | null
  relevant_experience_answer: string | null
  travel_answer: string | null
  start_availability: string | null
  latest_ai_run_id: string | null
  ai_score: number | null
  ai_recommendation: string | null
  ai_rationale: string | null
  ai_strengths: Json | null
  ai_concerns: Json | null
  ai_flags: Json | null
  ai_model: string | null
  ai_scored_at: string | null
  ai_scored_against_version: number | null
  booking_token_hash: string | null
  booking_token_type: string | null
  booking_token_expires_at: string | null
  booking_token_used_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  duplicate_of_application_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentStatusEventRow = {
  id: string
  application_id: string
  from_status: string | null
  to_status: string
  changed_by: string | null
  note: string | null
  metadata: Json | null
  created_at: string
  updated_at: string
}

type RecruitmentAiRunRow = {
  id: string
  operation: string
  candidate_id: string | null
  application_id: string | null
  job_posting_id: string | null
  model: string
  prompt_version: string
  input_hash: string
  status: string
  score: number | null
  recommendation: string | null
  structured_output: Json | null
  raw_response: Json | null
  error_message: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

type RecruitmentAppointmentSlotRow = {
  id: string
  type: string
  starts_at: string
  ends_at: string
  timezone: string
  location: string
  interviewer_user_id: string | null
  supervisor_staff_id: string | null
  status: string
  capacity: number
  created_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentCandidateAppointmentRow = {
  id: string
  application_id: string
  candidate_id: string
  slot_id: string | null
  type: string
  scheduled_start: string
  scheduled_end: string
  timezone: string
  location: string
  supervisor_staff_id: string | null
  status: string
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
  created_at: string
  updated_at: string
}

type RecruitmentEmailTemplateRow = {
  id: string
  type: string
  subject: string
  body: string
  is_active: boolean
  updated_by: string | null
  created_at: string
  updated_at: string
}

type RecruitmentCommunicationRow = {
  id: string
  application_id: string | null
  candidate_id: string
  type: string
  channel: string
  subject: string | null
  final_body: string
  was_ai_assisted: boolean
  ai_run_id: string | null
  edited_by: string | null
  sent_by: string | null
  sent_at: string | null
  delivery_status: string
  provider: string | null
  provider_message_id: string | null
  idempotency_key: string | null
  metadata: Json | null
  created_at: string
  updated_at: string
}

export type RecruitmentDatabaseExtension = {
  public: {
    Tables: {
      recruitment_job_postings: Table<RecruitmentJobPostingRow>
      recruitment_candidates: Table<RecruitmentCandidateRow, Partial<Omit<RecruitmentCandidateRow, 'id' | 'email_normalized' | 'created_at' | 'updated_at'>>, Partial<RecruitmentCandidateRow>>
      recruitment_applications: Table<RecruitmentApplicationRow, Partial<Omit<RecruitmentApplicationRow, 'id' | 'is_general' | 'created_at' | 'updated_at'>>, Partial<RecruitmentApplicationRow>>
      recruitment_application_status_events: Table<RecruitmentStatusEventRow>
      recruitment_ai_runs: Table<RecruitmentAiRunRow>
      recruitment_appointment_slots: Table<RecruitmentAppointmentSlotRow>
      recruitment_candidate_appointments: Table<RecruitmentCandidateAppointmentRow>
      recruitment_email_templates: Table<RecruitmentEmailTemplateRow>
      recruitment_communications: Table<RecruitmentCommunicationRow>
    }
    Functions: {
      recruitment_transition_application_status: {
        Args: {
          p_application_id: string
          p_to_status: string
          p_note?: string | null
          p_metadata?: Json
        }
        Returns: RecruitmentApplicationRow
      }
      recruitment_claim_appointment_slot: {
        Args: {
          p_slot_id: string
          p_application_id: string
          p_candidate_id: string
          p_booking_token_hash: string
          p_token_expires_at: string
        }
        Returns: string
      }
    }
  }
}
