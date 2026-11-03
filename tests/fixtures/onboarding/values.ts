import type { OnboardingSnapshot } from '@/app/actions/employeeInvite'

type OnboardingValues = Omit<OnboardingSnapshot, 'completedSections'>
type Sections = OnboardingSnapshot['completedSections']

const emptyContact = () => ({ name: '', relationship: '', phone_number: '', mobile_number: '', address: '' })

/** What getOnboardingSnapshot returns for a starter who has saved nothing yet. */
export function emptyOnboardingValues(): OnboardingValues {
  return {
    personal: {
      first_name: '', last_name: '', preferred_name: '', date_of_birth: '',
      address: '', post_code: '', phone_number: '', mobile_number: '',
    },
    emergency_contacts: { primary: emptyContact(), secondary: emptyContact() },
    financial: {
      ni_number: '', bank_name: '', payee_name: '', branch_address: '',
      bank_sort_code: '', bank_account_number: '',
    },
    health: {
      doctor_name: '', doctor_address: '', has_allergies: false, allergies: '',
      had_absence_over_2_weeks_last_3_years: false,
      had_outpatient_treatment_over_3_months_last_3_years: false,
      absence_or_treatment_details: '', illness_history: '', recent_treatment: '',
      has_diabetes: false, has_epilepsy: false, has_skin_condition: false,
      has_depressive_illness: false, has_bowel_problems: false, has_ear_problems: false,
      is_registered_disabled: false, disability_reg_number: '', disability_reg_expiry_date: '',
      disability_details: '',
    },
    time_off: { answer: null, submissionVersion: 0, blocks: [] },
    right_to_work_notice: { acknowledged: false },
  }
}

/** A starter who has filled in every section, with the NI and account numbers masked. */
export function filledOnboardingValues(): OnboardingValues {
  const values = emptyOnboardingValues()
  values.personal = {
    ...values.personal,
    first_name: 'Sam', last_name: 'Reed', date_of_birth: '1990-05-01',
    address: '1 High Street', post_code: 'TW19 6AQ', mobile_number: '+447700900123',
  }
  values.emergency_contacts.primary = {
    name: 'Jo Reed', relationship: 'Partner', phone_number: '', mobile_number: '+447700900456', address: '',
  }
  values.financial = {
    ni_number: '••••••56C', bank_name: 'Test Bank', payee_name: 'Sam Reed', branch_address: '',
    bank_sort_code: '11-22-33', bank_account_number: '••••5678',
  }
  values.health = { ...values.health, doctor_name: 'Dr Patel' }
  values.time_off = {
    answer: 'has_dates',
    submissionVersion: 1,
    blocks: [{ startDate: '2026-12-01', endDate: '2026-12-05', leaveType: 'holiday', note: 'Wedding' }],
  }
  values.right_to_work_notice = { acknowledged: true }
  return values
}

export function allSections(complete: boolean): Sections {
  return {
    personal: complete,
    time_off: complete,
    emergency_contacts: complete,
    financial: complete,
    health: complete,
    right_to_work_notice: complete,
  }
}
