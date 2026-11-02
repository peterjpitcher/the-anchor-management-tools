// The starter and staff see the same health question for the same column (siblings#3).
//
// The onboarding Health step asked "Epilepsy", "Skin condition" and "Ear problems", while the
// staff form and the health tab showed the same columns as "Suffer with Epilepsy/Fits/Blackouts?",
// "Suffer with Eczema/Dermatitis/Skin Disease?" and "Suffer with Earache or Infection?", and
// illness_history as "Additional Medical Notes". A starter with blackouts but not epilepsy left
// the box unticked, and staff read "No" to a question the starter was never asked. All four
// screens now take every label from src/lib/employees/health-questions.ts, and so does the staff
// New Employee flow (tested in employeeStaffForms.test.tsx).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployeeHealthRecord } from '@/types/database'

const saveOnboardingSection = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/app/actions/employeeInvite', () => ({
  saveOnboardingSection: (...args: unknown[]) => saveOnboardingSection(...args),
  submitOnboardingProfile: vi.fn(),
}))
vi.mock('@/app/actions/employeeActions', () => ({ upsertHealthRecord: vi.fn() }))

import HealthStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep'
import ReviewStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep'
import HealthRecordsForm from '@/components/features/employees/HealthRecordsForm'
import HealthRecordsTab from '@/components/features/employees/HealthRecordsTab'
import {
  HEALTH_CONDITION_FIELDS,
  HEALTH_QUESTIONS,
  type HealthQuestionField,
} from '@/lib/employees/health-questions'
import { allSections, filledOnboardingValues } from '../fixtures/onboarding/values'

const FIELDS = Object.keys(HEALTH_QUESTIONS) as HealthQuestionField[]

/** Every box ticked and every text answered, so every question, including the follow-ups, shows. */
const ANSWERED = {
  doctor_name: 'Dr Patel',
  doctor_address: '1 Surgery Lane',
  has_allergies: true,
  allergies: 'Peanuts',
  had_absence_over_2_weeks_last_3_years: true,
  had_outpatient_treatment_over_3_months_last_3_years: true,
  absence_or_treatment_details: 'Broken leg in 2025',
  illness_history: 'Asthma as a child',
  recent_treatment: 'Physiotherapy in August',
  has_diabetes: true,
  has_epilepsy: true,
  has_skin_condition: true,
  has_depressive_illness: true,
  has_bowel_problems: true,
  has_ear_problems: true,
  is_registered_disabled: true,
  disability_reg_number: 'REG-123',
  disability_reg_expiry_date: '2027-03-31',
  disability_details: 'Uses a hearing aid',
}

function staffRecord(overrides: Partial<EmployeeHealthRecord> = {}): EmployeeHealthRecord {
  return {
    employee_id: 'employee-1',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...ANSWERED,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the shared health question list', () => {
  it('has a question for every answer the starter saves, and nothing else', async () => {
    saveOnboardingSection.mockResolvedValue({ success: true })
    const onSuccess = vi.fn()
    render(<HealthStep token="invite-token" initialData={ANSWERED} onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const saved = saveOnboardingSection.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(saved).sort()).toEqual([...FIELDS].sort())
  })

  it('asks the broader questions staff use, as plain questions', () => {
    expect(HEALTH_QUESTIONS.has_epilepsy).toBe('Do you have epilepsy, fits or blackouts?')
    expect(HEALTH_QUESTIONS.has_skin_condition).toBe('Do you have eczema, dermatitis or other skin disease?')
    expect(HEALTH_QUESTIONS.has_ear_problems).toBe('Do you have earache or ear infections?')
    for (const field of HEALTH_CONDITION_FIELDS) {
      expect(HEALTH_QUESTIONS[field]).toMatch(/^Do you have .+\?$/)
    }
  })
})

describe('the starter is asked what staff will read', () => {
  it('the onboarding Health step asks every question by its shared wording', () => {
    render(<HealthStep token="invite-token" initialData={ANSWERED} onSuccess={vi.fn()} />)

    for (const field of FIELDS) {
      expect(screen.getByLabelText(HEALTH_QUESTIONS[field])).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Epilepsy')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ear problems')).not.toBeInTheDocument()
  })

  it('the Review step shows every question with the answer given, and the expiry as a date', () => {
    const values = filledOnboardingValues()
    values.health = { ...ANSWERED }
    render(<ReviewStep token="invite-token" values={values} savedSections={allSections(true)} />)

    const health = screen.getByRole('heading', { level: 3, name: 'Health Information' }).closest('li')!
    for (const field of FIELDS) {
      expect(within(health).getByText(HEALTH_QUESTIONS[field])).toBeInTheDocument()
    }
    const epilepsy = within(health).getByText(HEALTH_QUESTIONS.has_epilepsy).closest('div')!
    expect(within(epilepsy).getByText('Yes')).toBeInTheDocument()
    expect(within(health).getByText('Asthma as a child')).toBeInTheDocument()
    expect(within(health).getByText('Physiotherapy in August')).toBeInTheDocument()
    expect(within(health).getByText('31 March 2027')).toBeInTheDocument()
    expect(within(health).queryByText('2027-03-31')).not.toBeInTheDocument()
  })

  it('the Review step leaves out follow-up boxes the starter did not see', () => {
    const values = filledOnboardingValues()
    render(<ReviewStep token="invite-token" values={values} savedSections={allSections(true)} />)

    const health = screen.getByRole('heading', { level: 3, name: 'Health Information' }).closest('li')!
    const epilepsy = within(health).getByText(HEALTH_QUESTIONS.has_epilepsy).closest('div')!
    expect(within(epilepsy).getByText('No')).toBeInTheDocument()
    expect(within(health).queryByText(HEALTH_QUESTIONS.allergies)).not.toBeInTheDocument()
    expect(within(health).queryByText(HEALTH_QUESTIONS.absence_or_treatment_details)).not.toBeInTheDocument()
    expect(within(health).queryByText(HEALTH_QUESTIONS.disability_reg_number)).not.toBeInTheDocument()
  })

  it('the staff health form edits every column under the same question', () => {
    render(<HealthRecordsForm employeeId="employee-1" healthRecord={staffRecord()} cancelHref="/employees/employee-1" />)

    for (const field of FIELDS) {
      expect(screen.getByLabelText(HEALTH_QUESTIONS[field])).toBeInTheDocument()
    }
    expect(screen.getByLabelText(HEALTH_QUESTIONS.has_epilepsy)).toBeChecked()
    expect(screen.getByLabelText(HEALTH_QUESTIONS.illness_history)).toHaveValue('Asthma as a child')
  })

  it('the staff health tab shows every column under the same question', () => {
    render(<HealthRecordsTab employeeId="employee-1" healthRecord={staffRecord({ has_epilepsy: false })} canEdit />)

    for (const field of FIELDS) {
      expect(screen.getByText(HEALTH_QUESTIONS[field])).toBeInTheDocument()
    }
    const epilepsy = screen.getByText(HEALTH_QUESTIONS.has_epilepsy).closest('div')!
    expect(within(epilepsy).getByText('No')).toBeInTheDocument()
    const illness = screen.getByText(HEALTH_QUESTIONS.illness_history).closest('div')!
    expect(within(illness).getByText('Asthma as a child')).toBeInTheDocument()
    expect(screen.queryByText('Additional Medical Notes')).not.toBeInTheDocument()
    expect(screen.queryByText(/Suffer with/)).not.toBeInTheDocument()
  })
})
