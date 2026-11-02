// The staff employee forms: success handled once, typed values kept after a refused save, the
// edit form's locked status and last day, the delete redirect, links minted on click, and the
// new employee form checking everything before it creates anyone.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const push = vi.fn()
const refresh = vi.fn()
const router = { push, refresh, replace: vi.fn(), prefetch: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/employees/e1',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({ useSupabase: () => ({}) }))

vi.mock('@/app/actions/employeeActions', () => ({
  addEmployee: vi.fn(),
  addEmergencyContact: vi.fn(),
  addEmployeeAttachment: vi.fn(),
  createRightToWorkDocumentUploadUrl: vi.fn(),
  deleteEmergencyContact: vi.fn(),
  deleteEmployee: vi.fn(),
  deleteRightToWorkPhoto: vi.fn(),
  getRightToWorkPhotoUrl: vi.fn(),
  updateEmergencyContact: vi.fn(),
  updateEmployee: vi.fn(),
  updateOnboardingChecklist: vi.fn(),
  upsertRightToWork: vi.fn(),
}))

vi.mock('@/ds', async () => {
  const actual = await vi.importActual<typeof import('@/ds')>('@/ds')
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})

import { toast } from '@/ds'
import {
  addEmergencyContact,
  addEmployee,
  deleteEmployee,
  getRightToWorkPhotoUrl,
} from '@/app/actions/employeeActions'
import EmergencyContactsTab from '@/components/features/employees/EmergencyContactsTab'
import EmployeeForm from '@/components/features/employees/EmployeeForm'
import DeleteEmployeeButton from '@/components/features/employees/DeleteEmployeeButton'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import EmployeeNotesList from '@/components/features/employees/EmployeeNotesList'
import AddEmployeeAttachmentForm from '@/components/features/employees/AddEmployeeAttachmentForm'
import NewEmployeeOnboardingClient from '@/app/(authenticated)/employees/new/NewEmployeeOnboardingClient'
import type { ActionFormState } from '@/types/actions'
import type { AttachmentCategory, Employee, EmployeeEmergencyContact, EmployeeRightToWork } from '@/types/database'

let phoneLayout = false

beforeEach(() => {
  vi.clearAllMocks()
  phoneLayout = false
  window.matchMedia = ((query: string) => ({
    matches: phoneLayout,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.restoreAllMocks()
})

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  employee_id: 'e1', first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 's@example.com',
  job_title: 'Bar', status: 'Active', employment_start_date: '2026-01-01', employment_end_date: null,
  first_shift_date: null, date_of_birth: null, post_code: null, address: null, phone_number: null,
  mobile_number: null, uniform_preference: null, keyholder_status: false,
  ...overrides,
}) as unknown as Employee

describe('emergency contacts (FF-22)', () => {
  const contact = {
    id: 'c1', employee_id: 'e1', name: 'Alex Rowe', relationship: 'Partner', priority: 'Primary',
    phone_number: null, mobile_number: '+447561773635', address: null,
  } as unknown as EmployeeEmergencyContact

  it('refreshes once after adding a contact, and the add form opens again afterwards', async () => {
    ;(addEmergencyContact as Mock).mockResolvedValue({ type: 'success', message: 'Emergency contact added successfully.' })

    const { rerender } = render(<EmergencyContactsTab employeeId="e1" contacts={[]} canEdit />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Full Name/), { target: { value: 'Alex Rowe' } })
    fireEvent.change(within(dialog).getByLabelText('Mobile'), { target: { value: '07561 773635' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Contact' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    // The refresh hands the tab new contacts; that re-render must not refresh again.
    rerender(<EmergencyContactsTab employeeId="e1" contacts={[contact]} canEdit />)
    rerender(<EmergencyContactsTab employeeId="e1" contacts={[contact]} canEdit />)
    await act(async () => {})
    expect(refresh).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))
    const reopened = await screen.findByRole('dialog')
    await act(async () => {})
    expect(reopened).toBeInTheDocument()
    expect(within(reopened).getByLabelText(/Full Name/)).toHaveValue('')
  })

  it('keeps what was typed when the server refuses the contact (FF-28)', async () => {
    ;(addEmergencyContact as Mock).mockResolvedValue({
      type: 'error',
      message: 'Validation failed.',
      errors: { mobile_number: ['A primary contact needs a telephone or mobile number.'] },
    })

    render(<EmergencyContactsTab employeeId="e1" contacts={[]} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Full Name/), { target: { value: 'Alex Rowe' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Contact' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A primary contact needs a telephone or mobile number.')
    expect(within(dialog).getByLabelText(/Full Name/)).toHaveValue('Alex Rowe')
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('EmployeeForm (FF-23, FF-28)', () => {
  const refuse = vi.fn(async (): Promise<ActionFormState> => ({
    type: 'error',
    message: 'Invalid data provided. Please check your input and try again.',
    errors: { first_name: ['First name is required'] },
  }))

  it('shows the status as read-only for someone already working here', () => {
    render(<EmployeeForm employee={employee({ status: 'Active' })} formAction={refuse} initialFormState={null} />)

    expect(screen.queryByRole('combobox', { name: /Status/ })).toBeNull()
    const status = screen.getByLabelText(/Status/)
    expect(status).toHaveValue('Active')
    expect(status).toHaveAttribute('readonly')
    expect(screen.getByText(/use Begin Separation on the employee page/)).toBeInTheDocument()
  })

  it('offers only Onboarding or Active to a new starter', () => {
    render(<EmployeeForm employee={employee({ status: 'Onboarding' })} formAction={refuse} initialFormState={null} />)

    const options = within(screen.getByRole('combobox', { name: /Status/ })).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Onboarding', 'Active'])
  })

  it('locks the last day while a separation is under way', () => {
    render(
      <EmployeeForm
        employee={employee({ status: 'Started Separation', employment_end_date: '2026-11-30' })}
        formAction={refuse}
        initialFormState={null}
      />
    )

    const endDate = screen.getByLabelText(/Employment End Date/)
    expect(endDate).toHaveValue('2026-11-30')
    expect(endDate).toHaveAttribute('readonly')
    expect(screen.getByText(/Set by the separation/)).toBeInTheDocument()
  })

  it('keeps typed values after a refused save and lists what to fix', async () => {
    render(<EmployeeForm employee={employee()} formAction={refuse} initialFormState={null} />)

    fireEvent.change(screen.getByLabelText(/Job Title/), { target: { value: 'Bar supervisor' } })
    fireEvent.submit(screen.getByLabelText(/Job Title/).closest('form')!)

    expect(await screen.findByText('Please check these fields')).toBeInTheDocument()
    expect(screen.getByText('First Name: First name is required')).toBeInTheDocument()
    expect(screen.getByLabelText(/Job Title/)).toHaveValue('Bar supervisor')
  })

  it('on a phone, jumps back to the step with the error', async () => {
    phoneLayout = true
    render(<EmployeeForm employee={employee()} formAction={refuse} initialFormState={null} />)

    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Personal Details' }))

    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByText('First Name: First name is required')).toBeInTheDocument()
  })
})

describe('DeleteEmployeeButton (FF-39)', () => {
  it('goes to the list with a success message once the employee is deleted', async () => {
    ;(deleteEmployee as Mock).mockResolvedValue({ type: 'success', message: 'Employee deleted.' })

    render(<DeleteEmployeeButton employeeId="e1" employeeName="Sam Rowe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Only a new starter who is still onboarding can be deleted/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/employees'))
    expect(toast.success).toHaveBeenCalledWith('Employee deleted.')
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('warns when the login could not be removed', async () => {
    ;(deleteEmployee as Mock).mockResolvedValue({ type: 'success', message: 'Employee deleted.', warning: 'Employee deleted, but their login could not be removed.' })

    render(<DeleteEmployeeButton employeeId="e1" employeeName="Sam Rowe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/employees'))
    expect(toast.warning).toHaveBeenCalledWith('Employee deleted, but their login could not be removed.', expect.anything())
  })
})

describe('RightToWorkTab document links (FF-36)', () => {
  const rightToWork = {
    employee_id: 'e1', document_type: 'Passport', verification_date: '2026-10-01', document_expiry_date: null,
    follow_up_date: null, photo_storage_path: 'e1/rtw_1_passport.pdf', check_method: 'manual',
    document_reference: null, document_details: null,
  } as unknown as EmployeeRightToWork

  it('makes no link when the page loads, and makes one when View is clicked', async () => {
    ;(getRightToWorkPhotoUrl as Mock).mockResolvedValue({ url: 'https://signed/view', error: null })
    const newTab = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(newTab as unknown as Window)

    render(<RightToWorkTab employeeId="e1" rightToWork={rightToWork} canEdit canViewDocuments />)
    await act(async () => {})
    expect(getRightToWorkPhotoUrl).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /View Current Document/ }))

    // The tab opens on the click itself, before the link comes back.
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(newTab.location.href).toBe('https://signed/view'))
    expect(newTab.opener).toBeNull()
    expect(getRightToWorkPhotoUrl).toHaveBeenCalledWith('e1')
  })

  it('closes the opened tab and says so when the link cannot be made', async () => {
    ;(getRightToWorkPhotoUrl as Mock).mockResolvedValue({ url: null, error: 'Right to work photo not found.' })
    const newTab = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(newTab as unknown as Window)

    render(<RightToWorkTab employeeId="e1" rightToWork={rightToWork} canEdit canViewDocuments />)
    fireEvent.click(screen.getByRole('button', { name: /View Current Document/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Right to work photo not found.'))
    expect(newTab.close).toHaveBeenCalled()
  })

  it('asks for a named download link when Download is clicked', async () => {
    ;(getRightToWorkPhotoUrl as Mock).mockResolvedValue({ url: 'https://signed/download', error: null })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<RightToWorkTab employeeId="e1" rightToWork={rightToWork} canEdit canViewDocuments />)
    fireEvent.click(screen.getByRole('button', { name: /Download Document/ }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(getRightToWorkPhotoUrl).toHaveBeenCalledWith('e1', { download: true })
  })
})

describe('EmployeeNotesList (FF-38)', () => {
  it('shows the date and the London time each note was added', () => {
    render(
      <EmployeeNotesList
        notes={[{ note_id: 'n1', note_text: 'Spoke about shifts', created_at: '2026-07-14T23:30:00.000Z', author_name: 'Peter' } as never]}
      />
    )
    expect(screen.getByText(/15 Jul 2026, 00:30/)).toBeInTheDocument()
  })
})

describe('AddEmployeeAttachmentForm (FF-31)', () => {
  const categories = [
    { category_id: 'cat-1', category_name: 'Contracts', email_on_upload: true },
    { category_id: 'cat-2', category_name: 'Notes', email_on_upload: false },
  ] as AttachmentCategory[]

  it('warns before upload when the chosen category emails the employee', () => {
    render(<AddEmployeeAttachmentForm employeeId="e1" categories={categories} />)

    expect(screen.queryByText(/emailed to the employee/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } })
    expect(screen.getByText('Files in this category are emailed to the employee when you upload them.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-2' } })
    expect(screen.queryByText(/emailed to the employee/)).toBeNull()
  })
})

describe('NewEmployeeOnboardingClient (FF-26, FF-27, FF-30)', () => {
  function fillRequired() {
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Jo' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Bloggs' } })
    fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: 'jo@example.com' } })
    fireEvent.change(screen.getByLabelText(/Job Title/), { target: { value: 'Bar' } })
    fireEvent.change(screen.getByLabelText(/Employment Start Date/), { target: { value: '2026-11-10' } })
  }

  it('checks the emergency contact before creating anyone', async () => {
    render(<NewEmployeeOnboardingClient />)
    fillRequired()

    fireEvent.click(screen.getByRole('tab', { name: 'Emergency Contacts' }))
    const primaryName = screen.getAllByLabelText('Name')[0]
    fireEvent.change(primaryName, { target: { value: 'Alex' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create Employee' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect((toast.error as Mock).mock.calls[0][0]).toContain('Primary contact telephone or mobile')
    expect((toast.error as Mock).mock.calls[0][0]).toContain('Nothing has been saved yet')
    expect(addEmployee).not.toHaveBeenCalled()
  })

  it('checks a contact number is a real phone number before creating anyone', async () => {
    render(<NewEmployeeOnboardingClient />)
    fillRequired()

    fireEvent.click(screen.getByRole('tab', { name: 'Emergency Contacts' }))
    fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'Alex' } })
    fireEvent.change(screen.getAllByLabelText(/Mobile/)[0], { target: { value: '0756 177' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create Employee' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect((toast.error as Mock).mock.calls[0][0]).toContain('Primary contact mobile (not a valid phone number)')
    expect(addEmployee).not.toHaveBeenCalled()
  })

  it('names a preferred name that did not save, after the employee is created', async () => {
    ;(addEmployee as Mock).mockResolvedValue({
      type: 'success',
      message: 'Employee created successfully. The preferred name could not be saved. Please set it from the employee record.',
      employeeId: 'employee-9',
      warning: true,
      followUpError: 'Preferred name: The preferred name could not be saved. Please set it from the employee record.',
    })
    render(<NewEmployeeOnboardingClient />)
    fillRequired()

    fireEvent.click(screen.getByRole('button', { name: 'Create Employee' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/employees/employee-9'))
    expect((toast.error as Mock).mock.calls[0][0]).toContain('Employee created, but these did not save: Preferred name:')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('checks the right to work details before creating anyone', async () => {
    render(<NewEmployeeOnboardingClient />)
    fillRequired()

    fireEvent.click(screen.getByRole('tab', { name: 'Right to Work' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /right to work/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Employee' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect((toast.error as Mock).mock.calls[0][0]).toContain('Right to work document type')
    expect(addEmployee).not.toHaveBeenCalled()
  })

  it('has no hand-ticked agreement box, and points to Send for Signature', () => {
    render(<NewEmployeeOnboardingClient />)
    fireEvent.click(screen.getByRole('tab', { name: 'Agreement & Setup' }))

    expect(screen.queryByText(/has read, understood, and agreed/)).toBeNull()
    expect(screen.getByText(/use Send for Signature on their page/)).toBeInTheDocument()
  })

  it('asks for a contact address and the medical history questions', () => {
    render(<NewEmployeeOnboardingClient />)
    fireEvent.click(screen.getByRole('tab', { name: 'Emergency Contacts' }))
    expect(screen.getAllByLabelText('Address')).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: 'Health Information' }))
    expect(screen.getByLabelText('Illness history')).toBeInTheDocument()
    expect(screen.getByLabelText('Recent treatment')).toBeInTheDocument()
  })
})
