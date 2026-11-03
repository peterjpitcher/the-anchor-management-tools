/**
 * The health questions, worded once for every screen that asks or shows them: the starter's
 * onboarding Health step and Review step, the staff health form and health tab, and the staff
 * New Employee flow's Health Information tab.
 *
 * They used to be worded separately. The starter was asked "Epilepsy" and "Ear problems", and
 * staff read the same answers as "Suffer with Epilepsy/Fits/Blackouts?" and "Suffer with Earache
 * or Infection?", so a starter with blackouts but not epilepsy left the box unticked and staff
 * read "No" to a question the starter was never asked. The wording is the broader one staff
 * already used (owner decision, 2 November 2026), written as plain questions, so the starter is
 * asked exactly what staff will read.
 *
 * Pure data only, safe to import from client components.
 */
import type { Database } from '@/types/database.generated';

type HealthRecordRow = Database['public']['Tables']['employee_health_records']['Row'];

/** Every answer column on employee_health_records (the key and timestamps are not questions). */
export type HealthQuestionField = Exclude<keyof HealthRecordRow, 'employee_id' | 'created_at' | 'updated_at'>;

export const HEALTH_QUESTIONS = {
  doctor_name: "Doctor's Name",
  doctor_address: "Doctor's Address",
  has_allergies: 'Do you have any allergies?',
  allergies: 'What are you allergic to?',
  had_absence_over_2_weeks_last_3_years:
    'In the last 3 years, have you been off work for 2 weeks or more because of illness or an accident?',
  had_outpatient_treatment_over_3_months_last_3_years:
    'In the last 3 years, have you had outpatient treatment lasting 3 months or more?',
  absence_or_treatment_details: 'What was the time off or treatment for?',
  illness_history: 'Is there any other illness, past or present, that we should know about?',
  recent_treatment: 'Have you had any medical treatment recently?',
  has_diabetes: 'Do you have diabetes?',
  has_epilepsy: 'Do you have epilepsy, fits or blackouts?',
  has_skin_condition: 'Do you have eczema, dermatitis or other skin disease?',
  has_depressive_illness: 'Do you have a depressive illness?',
  has_bowel_problems: 'Do you have bowel problems?',
  has_ear_problems: 'Do you have earache or ear infections?',
  is_registered_disabled: 'Are you registered disabled?',
  disability_reg_number: 'Disability Registration Number',
  disability_reg_expiry_date: 'Registration Expiry Date',
  disability_details: 'Disability Details',
} as const satisfies Record<HealthQuestionField, string>;

/** The condition tick boxes, in the order every screen lists them. */
export const HEALTH_CONDITION_FIELDS = [
  'has_diabetes',
  'has_epilepsy',
  'has_skin_condition',
  'has_depressive_illness',
  'has_bowel_problems',
  'has_ear_problems',
] as const satisfies readonly HealthQuestionField[];
