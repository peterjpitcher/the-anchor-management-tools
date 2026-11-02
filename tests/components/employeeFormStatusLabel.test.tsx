// The edit form's read-only status for someone on notice (FF-70 follow-up).
//
// The employee page, roster and reliability page say "On Notice" for the stored status "Started
// Separation", but the edit form showed the stored value. The field is also what the form sends as
// status, so the words shown and the value sent are now separate: the label in a field with no
// name, the stored value in a hidden input.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/e1/edit',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/ds', async () => {
  const actual = await vi.importActual<typeof import('@/ds')>('@/ds')
  return { ...actual, toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }
})

import EmployeeForm from '@/components/features/employees/EmployeeForm'
import type { ActionFormState } from '@/types/actions'
import type { Employee } from '@/types/database'

beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  employee_id: 'e1', first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 's@example.com',
  job_title: 'Bar', status: 'Started Separation', employment_start_date: '2026-01-01', employment_end_date: '2026-11-30',
  first_shift_date: null, date_of_birth: null, post_code: null, address: null, phone_number: null,
  mobile_number: null, uniform_preference: null, keyholder_status: false,
  ...overrides,
}) as unknown as Employee

describe('EmployeeForm status for someone on notice', () => {
  it('shows On Notice, and sends the stored status unchanged', async () => {
    const formAction = vi.fn(async (_prev: ActionFormState | null, _formData: FormData): Promise<ActionFormState> => ({
      type: 'error',
      message: 'Refused for the test.',
    }))
    render(<EmployeeForm employee={employee()} formAction={formAction} initialFormState={null} />)

    const status = screen.getByLabelText(/Status/)
    expect(status).toHaveValue('On Notice')
    expect(status).toHaveAttribute('readonly')
    // The shown words are never sent as the status.
    expect(status).not.toHaveAttribute('name')
    const shownStoredValue = screen.queryAllByDisplayValue('Started Separation')
      .filter((input) => input.getAttribute('type') !== 'hidden')
    expect(shownStoredValue).toEqual([])
    const sent = status.closest('form')!.querySelector('input[type="hidden"][name="status"]')
    expect(sent).toHaveValue('Started Separation')
    expect(screen.getByText(/This employee is on notice\./)).toBeInTheDocument()

    fireEvent.submit(status.closest('form')!)

    await waitFor(() => expect(formAction).toHaveBeenCalledOnce())
    const formData = formAction.mock.calls[0][1]
    expect(formData.getAll('status')).toEqual(['Started Separation'])
  })

  it('keeps Active as it is', async () => {
    const formAction = vi.fn(async (_prev: ActionFormState | null, _formData: FormData): Promise<ActionFormState> => ({
      type: 'error',
      message: 'Refused for the test.',
    }))
    render(<EmployeeForm employee={employee({ status: 'Active', employment_end_date: null })} formAction={formAction} initialFormState={null} />)

    expect(screen.getByLabelText(/Status/)).toHaveValue('Active')

    fireEvent.submit(screen.getByLabelText(/Status/).closest('form')!)

    await waitFor(() => expect(formAction).toHaveBeenCalledOnce())
    expect(formAction.mock.calls[0][1].getAll('status')).toEqual(['Active'])
  })

  it('still offers the status as a choice to a new starter, sent once', async () => {
    const formAction = vi.fn(async (_prev: ActionFormState | null, _formData: FormData): Promise<ActionFormState> => ({
      type: 'error',
      message: 'Refused for the test.',
    }))
    render(<EmployeeForm employee={employee({ status: 'Onboarding', employment_end_date: null })} formAction={formAction} initialFormState={null} />)

    fireEvent.submit(screen.getByRole('combobox', { name: /Status/ }).closest('form')!)

    await waitFor(() => expect(formAction).toHaveBeenCalledOnce())
    expect(formAction.mock.calls[0][1].getAll('status')).toEqual(['Onboarding'])
  })
})
