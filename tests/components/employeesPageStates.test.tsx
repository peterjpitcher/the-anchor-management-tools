// The employees pages on the design-system page contract: each renders its DS states (a failed
// load keeps the header and says so rather than showing an empty list; empty lists use Empty) and
// every form renders on DS fields with a FormFooter. Server actions are stubbed; the real DS
// components render.
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('No employees found')).toBeInTheDocument()
    unmount()
    render(<EmployeesClient initialData={data} initialError="Boom" permissions={{ canCreate: true, canExport: true, canEdit: true }} />)
    expect(screen.getByText('Boom')).toBeInTheDocument()
    expect(screen.queryByText('No employees found')).not.toBeInTheDocument()
  })

  it('says the birthdays failed to load rather than showing an empty list', async () => {
    render(await BirthdaysPage())
    expect(screen.getByText('Could not load birthdays')).toBeInTheDocument()
    expect(screen.queryByText('No birthdays found')).not.toBeInTheDocument()
  })

  it('shows an empty reliability leaderboard with Empty', async () => {
    render(await ReliabilityPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('No employees found for this view')).toBeInTheDocument()
  })

  it('renders the detail tabs as cards with Empty states', async () => {
    render(<FinancialDetailsTab employeeId="e1" financialDetails={null} canEdit />)
    render(<HealthRecordsTab employeeId="e1" healthRecord={null} canEdit />)
    render(<EmergencyContactsTab employeeId="e1" contacts={[]} canEdit />)
    render(<EmployeeRecentChanges employeeId="e1" />)
    expect(await screen.findByText('No recent changes recorded')).toBeInTheDocument()
    expect(screen.getByText('No emergency contacts found')).toBeInTheDocument()
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
    expect(screen.getAllByText('Edit Sam').length).toBeGreaterThan(0)
  })

  it('labels the add note modal fields', async () => {
    render(<AddNoteModal isOpen onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Select Employee')).toBeInTheDocument()
  })

  it('says the pay details failed to load rather than showing no overrides', () => {
    const { unmount } = render(
      <EmployeePayTab employeeId="e1" canEdit initialPaySettings={null} initialOverrides={[]} currentRate={null} />,
    )
    expect(screen.getByText('No individual overrides set')).toBeInTheDocument()
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
    expect(screen.queryByText('No individual overrides set')).not.toBeInTheDocument()
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
    expect(screen.getByText(/No leave requests for/)).toBeInTheDocument()
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
    expect(screen.queryByText(/No leave requests for/)).not.toBeInTheDocument()
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
    const file = screen.getByLabelText(/File/)
    expect(file).toHaveAttribute('type', 'file')
    expect(file).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Upload Attachment' })).toBeInTheDocument()
  })
})
