import type { Database as GeneratedDatabase } from './database.generated';

export interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
  capacity: number | null;
  booking_mode?: 'table' | 'general' | 'mixed' | null;
  event_type?: string | null;
  category_id?: string | null;
  created_at: string;
  end_time?: string | null;
  event_status?: string | null;
  performer_name?: string | null;
  performer_type?: string | null;
  price?: number | null;
  is_free?: boolean | null;
  booking_url?: string | null;
  // Phase 1 SEO fields
  slug: string;
  short_description?: string | null;
  long_description?: string | null;
  highlights?: string[] | null;
  meta_title?: string | null;
  meta_description?: string | null;
  keywords?: string[] | null;
  hero_image_url?: string | null;
  gallery_image_urls?: string[] | null;
  poster_image_url?: string | null;
  thumbnail_image_url?: string | null;
  promo_video_url?: string | null;
  highlight_video_urls?: string[] | null;
  doors_time?: string | null;
  duration_minutes?: number | null;
  last_entry_time?: string | null;
  brief?: string | null;
  facebook_event_name?: string | null;
  facebook_event_description?: string | null;
  gbp_event_title?: string | null;
  gbp_event_description?: string | null;
  opentable_experience_title?: string | null;
  opentable_experience_description?: string | null;
}

export type PerformerSubmissionStatus =
  | 'new'
  | 'shortlisted'
  | 'contacted'
  | 'booked'
  | 'not_a_fit'
  | 'do_not_contact';

export interface PerformerSubmission {
  id: string;
  created_at: string;
  updated_at: string;

  full_name: string;
  email: string;
  phone: string;
  bio: string;

  consent_data_storage: boolean;

  status: PerformerSubmissionStatus;
  internal_notes: string | null;

  source: string;
  submitted_ip: string | null;
  user_agent: string | null;
}

export interface EventChecklistStatus {
  id: string;
  event_id: string;
  task_key: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventFAQ {
  id: string;
  event_id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ReceiptTransactionStatus =
  | 'pending'
  | 'completed'
  | 'auto_completed'
  | 'no_receipt_required'
  | 'cant_find';

export type ReceiptClassificationSource = 'ai' | 'manual' | 'rule' | 'import';

export type ReceiptExpenseCategory =
  | 'Total Staff'
  | 'Business Rate'
  | 'Water Rates'
  | 'Heat/Light/Power'
  | 'Premises Repairs/Maintenance'
  | 'Equipment Repairs/Maintenance'
  | 'Gardening Expenses'
  | 'Buildings Insurance'
  | 'Maintenance and Service Plan Charges'
  | 'Licensing'
  | 'Tenant Insurance'
  | 'Entertainment'
  | 'Sky / PRS / Vidimix'
  | 'Marketing/Promotion/Advertising'
  | 'Print/Post Stationary'
  | 'Telephone'
  | 'Travel/Car'
  | 'Waste Disposal/Cleaning/Hygiene'
  | 'Third Party Booking Fee'
  | 'Accountant/StockTaker/Professional Fees'
  | 'Bank Charges/Credit Card Commission'
  | 'Equipment Hire'
  | 'Sundries/Consumables'
  | 'Drinks Gas';

export type ReceiptRuleDirection = 'in' | 'out' | 'both';

export interface ReceiptBatch {
  id: string;
  uploaded_at: string;
  uploaded_by: string | null;
  original_filename: string;
  source_hash: string | null;
  row_count: number;
  notes: string | null;
  created_at: string;
}

export interface ReceiptRule {
  id: string;
  name: string;
  description: string | null;
  match_description: string | null;
  match_transaction_type: string | null;
  match_direction: ReceiptRuleDirection;
  match_min_amount: number | null;
  match_max_amount: number | null;
  auto_status: ReceiptTransactionStatus;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  set_vendor_name: string | null;
  set_expense_category: ReceiptExpenseCategory | null;
}

export interface ReceiptTransaction {
  id: string;
  batch_id: string | null;
  transaction_date: string;
  details: string;
  transaction_type: string | null;
  amount_in: number | null;
  amount_out: number | null;
  amount_total: number | null;
  balance: number | null;
  dedupe_hash: string;
  status: ReceiptTransactionStatus;
  receipt_required: boolean;
  marked_by: string | null;
  marked_by_email: string | null;
  marked_by_name: string | null;
  marked_at: string | null;
  marked_method: string | null;
  rule_applied_id: string | null;
  vendor_name: string | null;
  vendor_source: ReceiptClassificationSource | null;
  vendor_rule_id: string | null;
  vendor_updated_at: string | null;
  expense_category: ReceiptExpenseCategory | null;
  expense_category_source: ReceiptClassificationSource | null;
  expense_rule_id: string | null;
  expense_updated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptFile {
  id: string;
  transaction_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface ReceiptTransactionLog {
  id: string;
  transaction_id: string;
  previous_status: ReceiptTransactionStatus | null;
  new_status: ReceiptTransactionStatus | null;
  action_type: string;
  note: string | null;
  performed_by: string | null;
  rule_id: string | null;
  performed_at: string;
}

export interface AIUsageEvent {
  id: number;
  occurred_at: string;
  context: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
}

export type PLTimeframe = '1m' | '3m' | '12m'

export interface PLTarget {
  metric_key: string;
  timeframe: PLTimeframe;
  target_value: number | null;
  updated_at: string;
}

export interface PLManualActual {
  metric_key: string;
  timeframe: PLTimeframe;
  value: number | null;
  updated_at: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string | null;
  mobile_number: string;
  email?: string | null;
  created_at: string;
  sms_opt_in?: boolean | null;
  sms_delivery_failures?: number | null;
  last_sms_failure_reason?: string | null;
  last_successful_sms_at?: string | null;
  sms_deactivated_at?: string | null;
  sms_deactivation_reason?: string | null;
  messaging_status?: string | null;
  last_successful_delivery?: string | null;
  consecutive_failures?: number | null;
  total_failures_30d?: number | null;
  last_failure_type?: string | null;
}

export interface Booking {
  id: string;
  customer_id: string;
  event_id: string;
  seats: number | null;
  is_reminder_only: boolean;
  notes: string | null;
  created_at: string;
  // Join fields
  customer?: Customer;
  event?: Event;
}

export interface BookingReminder {
  id: string;
  booking_id: string;
  reminder_type: '24_hour' | '7_day' | '1_hour' | '12_hour' | 'custom';
  sent_at: string;
  message_id: string | null;
  created_at: string;
}

export interface Employee {
  employee_id: string; // UUID
  first_name: string;
  last_name: string;
  date_of_birth?: string | null; // Date
  address?: string | null;
  post_code?: string | null;
  phone_number?: string | null;
  mobile_number?: string | null;
  email_address: string;
  job_title: string;
  employment_start_date: string; // Date
  employment_end_date?: string | null; // Date
  first_shift_date?: string | null; // Date
  status: string; // e.g., 'Active', 'Former', 'Prospective'
  uniform_preference?: string | null;
  keyholder_status?: boolean | null;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeFinancialDetails {
  employee_id: string; // UUID, Primary Key, Foreign Key to Employee
  ni_number?: string | null;
  bank_account_number?: string | null;
  bank_sort_code?: string | null;
  bank_name?: string | null;
  payee_name?: string | null;
  branch_address?: string | null;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeHealthRecord {
  employee_id: string; // UUID, Primary Key, Foreign Key to Employee
  doctor_name?: string | null;
  doctor_address?: string | null;
  allergies?: string | null;
  has_allergies?: boolean | null;
  had_absence_over_2_weeks_last_3_years?: boolean | null;
  had_outpatient_treatment_over_3_months_last_3_years?: boolean | null;
  absence_or_treatment_details?: string | null;
  illness_history?: string | null;
  recent_treatment?: string | null;
  has_diabetes: boolean;
  has_epilepsy: boolean;
  has_skin_condition: boolean;
  has_depressive_illness: boolean;
  has_bowel_problems: boolean;
  has_ear_problems: boolean;
  is_registered_disabled: boolean;
  disability_reg_number?: string | null;
  disability_reg_expiry_date?: string | null; // Date
  disability_details?: string | null;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeNote {
  note_id: string; // UUID
  employee_id: string; // UUID, Foreign Key to Employee
  note_text: string;
  created_at: string; // Timestamp
  created_by_user_id?: string | null; // UUID, Foreign Key to auth.users (optional)
}

export interface AttachmentCategory {
  category_id: string; // UUID
  category_name: string;
  email_on_upload: boolean;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeAttachment {
  attachment_id: string; // UUID
  employee_id: string; // UUID, Foreign Key to Employee
  category_id: string; // UUID, Foreign Key to AttachmentCategory
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number; // Supabase uses bigint, but we use number for files up to ~9PB (Number.MAX_SAFE_INTEGER)
  description?: string | null;
  uploaded_at: string; // Timestamp
}

export interface EmployeeEmergencyContact {
  id: string; // UUID
  employee_id: string; // UUID, Foreign Key to Employee
  name: string;
  relationship?: string | null;
  address?: string | null;
  phone_number?: string | null;
  mobile_number?: string | null;
  priority?: 'Primary' | 'Secondary' | 'Other' | null;
  created_at: string; // Timestamp
}

export type EmployeeRightToWorkDocumentType =
  | 'Passport'
  | 'Biometric Residence Permit'
  | 'Share Code'
  | 'Other'
  | 'List A'
  | 'List B'
  | (string & {});

export interface EmployeeRightToWork {
  employee_id: string; // UUID, Primary Key, Foreign Key to Employee
  document_type: EmployeeRightToWorkDocumentType;
  check_method?: 'manual' | 'online' | 'digital' | null;
  document_reference?: string | null;
  document_details?: string | null;
  verification_date: string; // Date
  document_expiry_date?: string | null; // Date
  follow_up_date?: string | null; // Date
  verified_by_user_id?: string | null; // UUID
  photo_storage_path?: string | null;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeOnboardingChecklist {
  employee_id: string; // UUID, Primary Key, Foreign Key to Employee
  wheniwork_invite_sent?: boolean | null;
  wheniwork_invite_date?: string | null; // Date
  private_whatsapp_added?: boolean | null;
  private_whatsapp_date?: string | null; // Date
  team_whatsapp_added?: boolean | null;
  team_whatsapp_date?: string | null; // Date
  till_system_setup?: boolean | null;
  till_system_date?: string | null; // Date
  training_flow_setup?: boolean | null;
  training_flow_date?: string | null; // Date
  employment_agreement_drafted?: boolean | null;
  employment_agreement_date?: string | null; // Date
  employee_agreement_accepted?: boolean | null;
  employee_agreement_accepted_date?: string | null; // Timestamp
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface Message {
  id: string;
  customer_id: string;
  direction: 'inbound' | 'outbound';
  message_sid: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  twilio_message_sid: string | null;
  twilio_status: string | null;
  error_code: string | null;
  error_message: string | null;
  price: number | null;
  price_unit: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  from_number?: string | null;
  to_number?: string | null;
  message_type?: string | null;
  read_at?: string | null;
  segments?: number;
  cost_usd?: number;
}

export interface MessageDeliveryStatus {
  id: string;
  message_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  raw_webhook_data: Record<string, unknown>;
}

export interface WebhookLog {
  id: string;
  webhook_type: string;
  status: string;
  headers: Record<string, unknown> | null;
  body: string | null;
  params: Record<string, unknown> | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  processed_at: string;
  message_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  message_body: string | null;
  customer_id: string | null;
  message_id: string | null;
}

export interface AuditLog {
  id: string;
  created_at: string;
  user_id?: string | null;
  user_email?: string | null;
  operation_type: string;
  resource_type: string;
  resource_id?: string | null;
  operation_status: 'success' | 'failure';
  ip_address?: string | null;
  user_agent?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  error_message?: string | null;
  additional_info?: Record<string, unknown> | null;
}

export interface MessageTemplate {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  description?: string | null;
  template_type?: string | null;
  content: string;
  variables: string[] | null;
  is_default?: boolean;
  is_active: boolean;
  created_by?: string | null;
  character_count?: number;
  estimated_segments?: number;
  send_timing?: string | null;
  custom_timing_hours?: number | null;
}

export interface EventMessageTemplate {
  id: string;
  event_id: string;
  template_type: string;
  custom_content: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  created_at: string;
}

export interface CustomerCategoryStats {
  customer_id: string;
  category_id: string;
  booking_badge: number;
  total_spent: number;
  last_booking_date: string;
  created_at: string;
  updated_at: string;
}

export interface EventCategory {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type Database = GeneratedDatabase;

export type HiringJobStatus = 'draft' | 'open' | 'closed' | 'archived' | 'expired';
export type HiringApplicationStage = 'new' | 'screening' | 'screened' | 'in_conversation' | 'interview_scheduled' | 'interviewed' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
export type HiringCandidateSource = 'website' | 'indeed' | 'linkedin' | 'referral' | 'walk_in' | 'agency' | 'other';
export type HiringApplicationOutcomeStatus = 'hired' | 'rejected' | 'withdrawn' | 'offer_declined' | 'no_show';
export type HiringApplicationOutcomeCategory = 'experience' | 'skills' | 'availability' | 'right_to_work' | 'culture_fit' | 'communication' | 'compensation' | 'role_closed' | 'other';
export type HiringMessageDirection = 'outbound' | 'inbound';
export type HiringMessageStatus = 'draft' | 'sent' | 'failed' | 'cancelled';
export type HiringInterviewAttendeeRole = 'candidate' | 'interviewer' | 'observer';

export interface HiringJobTemplate {
  id: string;
  title: string;
  description: string | null;
  prerequisites: any;
  screening_config: any;
  screening_questions: any;
  interview_questions: any;
  screening_rubric: any;
  email_templates: any;
  message_templates: any;
  compliance_lines: any;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface HiringJob {
  id: string;
  slug: string | null;
  title: string;
  status: HiringJobStatus;
  location: string | null;
  employment_type: string | null;
  salary_range: string | null;
  description: string | null;
  requirements: any;
  prerequisites: any;
  screening_questions: any;
  interview_questions: any;
  screening_rubric: any;
  message_templates: any;
  compliance_lines: any;
  posting_date?: string | null;
  closing_date?: string | null;
  template_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface HiringCandidate {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  secondary_emails: string[];
  phone?: string | null;
  location?: string | null;
  resume_url?: string | null;
  parsed_data: any;
  parsing_status?: string | null;
  parsing_error?: string | null;
  parsing_updated_at?: string | null;
  resume_text?: string | null;
  search_vector?: any;
  current_profile_version_id?: string | null;
  anonymized_at?: string | null;
  retention_exempt: boolean;
  created_at: string;
  updated_at: string;
}

export interface HiringApplication {
  id: string;
  job_id: string;
  candidate_id: string;
  stage: HiringApplicationStage;
  source: HiringCandidateSource;
  ai_score?: number | null;
  ai_recommendation?: string | null;
  ai_score_raw?: number | null;
  ai_recommendation_raw?: string | null;
  ai_confidence?: number | null;
  ai_screening_result: any;
  screening_status?: string | null;
  screening_error?: string | null;
  latest_screening_run_id?: string | null;
  screening_updated_at?: string | null;
  screener_answers: any;
  interview_date?: string | null;
  outcome_status?: HiringApplicationOutcomeStatus | null;
  outcome_reason_category?: HiringApplicationOutcomeCategory | null;
  outcome_reason?: string | null;
  outcome_notes?: string | null;
  outcome_recorded_at?: string | null;
  outcome_recorded_by?: string | null;
  outcome_reviewed_at?: string | null;
  outcome_reviewed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringNote {
  id: string;
  entity_type: 'candidate' | 'application';
  entity_id: string;
  content: string;
  author_id: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface HiringCandidateDocument {
  id: string;
  candidate_id: string;
  storage_path: string;
  file_name: string;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  source?: string | null;
  uploaded_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringCandidateProfileVersion {
  id: string;
  candidate_id: string;
  document_id?: string | null;
  version_number: number;
  parsed_data: any;
  diff_summary?: string | null;
  diff_data: any;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringCandidateEvent {
  id: string;
  candidate_id: string;
  application_id?: string | null;
  job_id?: string | null;
  event_type: string;
  source?: string | null;
  metadata: any;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringApplicationMessage {
  id: string;
  application_id: string;
  candidate_id: string;
  channel: string;
  direction: HiringMessageDirection;
  status: HiringMessageStatus;
  subject?: string | null;
  body?: string | null;
  template_key?: string | null;
  sent_via?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  external_reference?: string | null;
  error_message?: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface HiringOutreachMessage {
  id: string;
  job_id: string;
  candidate_id: string;
  channel: string;
  direction: HiringMessageDirection;
  status: HiringMessageStatus;
  subject?: string | null;
  body?: string | null;
  template_key?: string | null;
  sent_via?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  external_reference?: string | null;
  error_message?: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface HiringApplicationOverride {
  id: string;
  application_id: string;
  override_type: string;
  previous_score?: number | null;
  new_score?: number | null;
  previous_recommendation?: string | null;
  new_recommendation?: string | null;
  reason?: string | null;
  metadata: any;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringScreeningRun {
  id: string;
  application_id: string;
  candidate_id: string;
  job_id: string;
  run_type: string;
  run_reason?: string | null;
  status: string;
  error_message?: string | null;
  model?: string | null;
  temperature?: number | null;
  prompt_version?: string | null;
  job_snapshot: any;
  candidate_snapshot: any;
  rubric_snapshot: any;
  screener_answers: any;
  result_raw: any;
  score_raw?: number | null;
  recommendation_raw?: string | null;
  score_calibrated?: number | null;
  recommendation_calibrated?: string | null;
  confidence?: number | null;
  evidence: any;
  strengths: any;
  concerns: any;
  experience_analysis?: string | null;
  draft_replies: any;
  usage: any;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringInterview {
  id: string;
  application_id: string;
  scheduled_at: string;
  end_at?: string | null;
  duration_minutes?: number | null;
  location?: string | null;
  calendar_event_id?: string | null;
  calendar_event_url?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringInterviewAttendee {
  id: string;
  interview_id: string;
  role: HiringInterviewAttendeeRole;
  name?: string | null;
  email?: string | null;
  user_id?: string | null;
  created_at: string;
  updated_at: string;
}
