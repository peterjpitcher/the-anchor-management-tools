// The employees pages on the design-system page contract: each renders its DS states (a failed
// load keeps the header and says so rather than showing an empty list; empty lists use Empty) and
// every form renders on DS fields with a FormFooter. Server actions are stubbed; the real DS
// components render.
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock('@/contexts/PermissionContext', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))
vi.mock('@/components/providers/SupabaseProvider', () => ({ useSupabase: () => ({}) }))
vi.mock('@/app/actions/employeeExport', () => ({ exportEmployees: vi.fn() }))
vi.mock('@/app/actions/employeeInvite', () => ({ sendPortalInvite: vi.fn(), inviteEmployee: vi.fn() }))
vi.mock('@/app/actions/employee-history', () => ({ getEmployeeChangesSummary: vi.fn().mockResolvedValue({ data: [] }) }))
vi.mock('@/app/actions/employeeActions', () => ({
  addEmployee: vi.fn(), addEmergencyContact: vi.fn(), createRightToWorkDocumentUploadUrl: vi.fn(),
  upsertRightToWork: vi.fn(), updateOnboardingChecklist: vi.fn(), updateEmployee: vi.fn(),
  upsertFinancialDetails: vi.fn(), upsertHealthRecord: vi.fn(), deleteEmergencyContact: vi.fn(),
  updateEmergencyContact: vi.fn(), getRightToWorkPhotoUrl: vi.fn().mockResolvedValue({}), deleteRightToWorkPhoto: vi.fn(),
  getEmployeeList: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Sam' }]), addEmployeeNote: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/employee-birthdays', () => ({
  getAllBirthdays: vi.fn().mockResolvedValue({ error: 'Failed to fetch employees' }),
}))
vi.mock('@/components/features/employees/SendBirthdayRemindersButton', () => ({
  default: () => <button type="button">Send reminders</button>,
}))
vi.mock('@/services/employee-reliability', () => ({
  getTeamReliabilityLeaderboard: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/app/actions/pay-bands', () => ({
  upsertEmployeePaySettings: vi.fn(), addEmployeeRateOverride: vi.fn(), updateEmployeeRateOverride: vi.fn(),
}))
vi.mock('@/app/actions/leave', () => ({ bookApprovedHoliday: vi.fn() }))

import EmployeesClient from '@/app/(authenticated)/employees/_components/EmployeesClient'
import ReliabilityPage from '@/app/(authenticated)/employees/reliability/page'
import BirthdaysPage from '@/app/(authenticated)/employees/birthdays/page'
import FinancialDetailsTab from '@/components/features/employees/FinancialDetailsTab'
import HealthRecordsTab from '@/components/features/employees/HealthRecordsTab'
import EmergencyContactsTab from '@/components/features/employees/EmergencyContactsTab'
import { EmployeeRecentChanges } from '@/components/features/employees/EmployeeRecentChanges'
import EmployeeForm from '@/components/features/employees/EmployeeForm'
import FinancialDetailsForm from '@/components/features/employees/FinancialDetailsForm'
import HealthRecordsForm from '@/components/features/employees/HealthRecordsForm'
import NewEmployeeOnboardingClient from '@/app/(authenticated)/employees/new/NewEmployeeOnboardingClient'
import EmployeeEditClient from '@/app/(authenticated)/employees/[employee_id]/edit/EmployeeEditClient'
import AddNoteModal from '@/components/modals/AddNoteModal'
import EmployeePayTab from '@/components/features/employees/EmployeePayTab'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import AddEmployeeAttachmentForm from '@/components/features/employees/AddEmployeeAttachmentForm'
import type { Employee } from '@/types/database'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
})

const employee = {
  employee_id: 'e1', first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 's@example.com',
  job_title: 'Bar', status: 'Active', employment_start_date: '2026-01-01', employment_end_date: null,
  first_shift_date: null, date_of_birth: null, post_code: null, address: null, phone_number: null,
  mobile_number: null, uniform_preference: null, keyholder_status: false,
} as unknown as Employee

describe('employees pages on the page contract', () => {
  it('renders the roster, and a failed load as an error rather than an empty list', () => {
    const data = {
      employees: [], pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
      statusCounts: { all: 0, active: 0, former: 0, onboarding: 0, startedSeparation: 0 },
      filters: { statusFilter: 'Active' as const, searchTerm: '' },
    }
    const { unmount } = render(<EmployeesClient initialData={data} permissions={{ canCreate: true, canExport: true, canEdit: true }} />)
    expect(screen.getAllByText('Employees').length).toBeGreaterThan(0)
    expect(screen.getByText('No employees yet')).toBeInTheDocument()
    unmount()
    render(<EmployeesClient initialData={data} initialError="Boom" permissions={{ canCreate: true, canExport: true, canEdit: true }} />)
    expect(screen.getByText('Boom')).toBeInTheDocument()
    expect(screen.queryByText('No employees yet')).not.toBeInTheDocument()
  })

  it('says the birthdays failed to load rather than showing an empty list', async () => {
    render(await BirthdaysPage())
    // Titled with the sidebar entry that owns the tab row; the subtitle names the tab.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Employees' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Birthdays: every employee birthday, month by month').length).toBeGreaterThan(0)
    expect(screen.getByText('Could not load birthdays')).toBeInTheDocument()
    expect(screen.queryByText('No birthdays yet')).not.toBeInTheDocument()
  })

  it('shows an empty reliability leaderboard with Empty', async () => {
    render(await ReliabilityPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getAllByRole('heading', { level: 1, name: 'Employees' }).length).toBeGreaterThan(0)
    expect(screen.getByText('No employees match these filters')).toBeInTheDocument()
  })

  it('renders the detail tabs as cards with Empty states', async () => {
    render(<FinancialDetailsTab employeeId="e1" financialDetails={null} canEdit />)
    render(<HealthRecordsTab employeeId="e1" healthRecord={null} canEdit />)
    render(<EmergencyContactsTab employeeId="e1" contacts={[]} canEdit />)
    render(<EmployeeRecentChanges employeeId="e1" />)
    expect(await screen.findByText('No changes yet')).toBeInTheDocument()
    expect(screen.getByText('No emergency contacts yet')).toBeInTheDocument()
  })

  it('renders the edit forms on DS fields', () => {
    render(<EmployeeForm employee={employee} formAction={vi.fn()} initialFormState={null} cancelHref="/employees/e1" />)
    expect(screen.getByLabelText(/First Name/)).toHaveValue('Sam')
    render(<FinancialDetailsForm employeeId="e1" financialDetails={null} cancelHref="/employees/e1" />)
    render(<HealthRecordsForm employeeId="e1" healthRecord={null} cancelHref="/employees/e1" />)
    expect(screen.getByLabelText('Is Registered Disabled?')).toBeInTheDocument()
  })

  it('renders the new employee flow with a FormFooter, and the edit page', async () => {
    const user = userEvent.setup()
    render(<NewEmployeeOnboardingClient />)
    expect(screen.getByRole('button', { name: /Create Employee/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/employees')
    await user.click(screen.getByRole('tab', { name: 'Health Information' }))
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Agreement & Setup' }))
    expect(screen.getByText('Zero Tolerance')).toBeInTheDocument()
    render(
      <EmployeeEditClient employee={employee} financialDetails={null} healthRecord={null} rightToWork={null} canViewDocuments />,
    )
    expect(screen.getAllByRole('heading', { level: 1, name: 'Edit Employee' }).length).toBeGreaterThan(0)
    // The employee's name is the subtitle, as their page is titled.
    expect(screen.getAllByText('Sam Rowe').length).toBeGreaterThan(0)
    // Back to the employee's page, labelled with that page's title (the legal name here).
    expect(screen.getAllByRole('button', { name: 'Back to Sam Rowe' }).length).toBeGreaterThan(0)
  })

  it('labels the add note modal fields', async () => {
    render(<AddNoteModal isOpen onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Select Employee')).toBeInTheDocument()
  })

  it('says the pay details failed to load rather than showing no overrides', () => {
    const { unmount } = render(
      <EmployeePayTab employeeId="e1" canEdit initialPaySettings={null} initialOverrides={[]} currentRate={null} />,
    )
    expect(screen.getByText('No overrides yet')).toBeInTheDocument()
    unmount()

    render(
      <EmployeePayTab
        employeeId="e1"
        canEdit
        initialPaySettings={null}
        initialOverrides={[]}
        currentRate={null}
        loadError="relation does not exist"
      />,
    )
    expect(screen.getByText('Could not load pay details')).toBeInTheDocument()
    expect(screen.getByText('relation does not exist')).toBeInTheDocument()
    expect(screen.queryByText('No overrides yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('says the holidays failed to load rather than showing no leave', () => {
    const rotaSettings = { holidayYearStartMonth: 4, holidayYearStartDay: 1, defaultHolidayDays: 28 }
    const { unmount } = render(
      <EmployeeHolidaysTab
        employeeId="e1"
        canCreateLeave
        leaveRequests={[]}
        leaveDays={[]}
        paySettings={null}
        rotaSettings={rotaSettings}
      />,
    )
    expect(screen.getByText(/No holiday requests for/)).toBeInTheDocument()
    unmount()

    render(
      <EmployeeHolidaysTab
        employeeId="e1"
        canCreateLeave
        leaveRequests={[]}
        leaveDays={[]}
        paySettings={null}
        rotaSettings={rotaSettings}
        loadError="Permission denied"
      />,
    )
    expect(screen.getByText('Could not load holidays')).toBeInTheDocument()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    expect(screen.queryByText(/No holiday requests for/)).not.toBeInTheDocument()
    expect(screen.queryByText(/days remaining/)).not.toBeInTheDocument()
  })

  it('attaches documents through a labelled DS file field', () => {
    render(
      <AddEmployeeAttachmentForm
        employeeId="e1"
        categories={[{
          category_id: 'c1', category_name: 'Contracts', email_on_upload: false,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        }]}
      />,
    )
    // The DS FileButton: a real button named by the Field label, over a hidden input.
    const file = screen.getByLabelText(/File/)
    expect(file.tagName).toBe('BUTTON')
    expect(file).toBeEnabled()
    const upload = screen.getByRole('button', { name: 'Upload Attachment' })
    expect(upload).toBeInTheDocument()

    // Nothing picked: the form says so under the field rather than sending nothing.
    fireEvent.submit(upload.closest('form') as HTMLFormElement)
    expect(screen.getByText('A file is required.')).toBeInTheDocument()
  })

  it('shows the current hourly rate in green, as before the page contract', () => {
    render(
      <EmployeePayTab
        employeeId="e1"
        canEdit
        initialPaySettings={null}
        initialOverrides={[]}
        currentRate={{ rate: 12.21, source: 'age_band' }}
      />,
    )
    expect(screen.getByText('£12.21/hr')).toHaveClass('text-success-fg')
  })

  it('keeps an invalid edit of a rate row above the table, never beside the add form', async () => {
    const user = userEvent.setup()
    render(
      <EmployeePayTab
        employeeId="e1"
        canEdit
        initialPaySettings={null}
        initialOverrides={[{
          id: 'o1', employee_id: 'e1', hourly_rate: 14, effective_from: '2099-01-01',
          created_at: '2026-01-01T00:00:00Z',
        }]}
        currentRate={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add Override' }))
    const row = within(screen.getByText('£14.00/hr').closest('tr') as HTMLElement)
    await user.click(row.getByRole('button', { name: 'Edit' }))
    await user.clear(row.getByRole('spinbutton', { name: 'Hourly rate (£)' }))
    await user.click(row.getByRole('button', { name: 'Save Changes' }))

    // One message, and not in the add form, which has nothing wrong with it.
    expect(screen.getAllByText('Enter a valid hourly rate')).toHaveLength(1)
    const addForm = screen.getByRole('heading', { name: 'Add Override' }).parentElement as HTMLElement
    expect(addForm).not.toHaveTextContent('Enter a valid hourly rate')

    // The add form's own mistake shows in the add form, even while a row is being edited.
    await user.click(within(addForm).getByRole('button', { name: 'Add Override' }))
    expect(addForm).toHaveTextContent('Enter a valid hourly rate')
    expect(screen.getAllByText('Enter a valid hourly rate')).toHaveLength(2)

    // Cancelling the row edit clears only the row's message.
    await user.click(row.getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByText('Enter a valid hourly rate')).toHaveLength(1)
    expect(addForm).toHaveTextContent('Enter a valid hourly rate')
  })

  it('heads each emergency contact with its name', () => {
    render(
      <EmergencyContactsTab
        employeeId="e1"
        canEdit={false}
        contacts={[{
          id: 'c1', employee_id: 'e1', name: 'Pat Rowe', relationship: 'Parent', priority: 'Primary',
          created_at: '2026-01-01T00:00:00Z',
        }]}
      />,
    )
    expect(screen.getByRole('heading', { level: 4, name: 'Pat Rowe' })).toBeInTheDocument()
  })
})
