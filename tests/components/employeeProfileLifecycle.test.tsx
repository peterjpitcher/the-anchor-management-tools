// The employee record's lifecycle and display fixes (FF-05, FF-13, FF-15, FF-23, FF-27, FF-41 to
// FF-44), as staff see them.
//
// Instants are written in UTC so the file reads the same in both test zones: 10:00 UTC on
// Monday 2 November 2026 is 10:00 GMT in London.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmployeeStatusActions from '@/components/features/employees/EmployeeStatusActions'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import HealthRecordsTab from '@/components/features/employees/HealthRecordsTab'
import FinancialDetailsTab from '@/components/features/employees/FinancialDetailsTab'
import OnboardingChecklistTab from '@/components/features/employees/OnboardingChecklistTab'
import { EmployeeAuditTrail } from '@/components/features/employees/EmployeeAuditTrail'
import type { AuditLogEntry } from '@/app/actions/employeeDetails'
import type { EmployeeLeaveDay } from '@/app/actions/leave'
import type { EmployeeHealthRecord } from '@/types/database'

const cancelMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn())
const getOnboardingProgressMock = vi.hoisted(() => vi.fn())
const updateChecklistMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock('@/app/actions/employeeSeparation', () => ({
  getEmployeeSeparationPreview: vi.fn(),
  beginEmployeeSeparation: vi.fn(),
  cancelEmployeeSeparation: cancelMock,
}))
vi.mock('@/app/actions/employeeInvite', () => ({ resendInvite: vi.fn(), revokeEmployeeAccess: revokeMock }))
vi.mock('@/app/actions/leave', () => ({ bookApprovedHoliday: vi.fn() }))
vi.mock('@/app/actions/employeeActions', () => ({
  getOnboardingProgress: getOnboardingProgressMock,
  updateOnboardingChecklist: updateChecklistMock,
}))
vi.mock('@/ds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ds')>()),
  toast: toastMock,
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-11-02T10:00:00Z'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeeStatusActions for someone on notice', () => {
  function renderOnNotice(employmentEndDate: string | null) {
    return render(
      <EmployeeStatusActions
        employeeId={EMPLOYEE_ID}
        status="Started Separation"
        canEdit
        employmentStartDate="2026-01-01"
        employmentEndDate={employmentEndDate}
      />,
    )
  }

  it('holds Mark as Former until the last working day, and says when', () => {
    renderOnNotice('2026-11-20')

    expect(screen.getByRole('button', { name: 'Mark as Former from 20 Nov' })).toBeDisabled()
  })

  it('offers Mark as Former on the last working day itself', () => {
    renderOnNotice('2026-11-02')

    expect(screen.getByRole('button', { name: 'Mark as Former' })).toBeEnabled()
  })

  // FF-47: they are Former either way, but a login that could not be deleted is said, not hidden.
  it('says so when they are Former but their login could not be deleted', async () => {
    const warning = 'They are now Former and their permissions are removed, but their login could not be deleted. Ask an administrator to delete it.'
    revokeMock.mockResolvedValue({ success: true, warning })
    const user = userEvent.setup()
    renderOnNotice('2026-11-02')

    await user.click(screen.getByRole('button', { name: 'Mark as Former' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as Former' }))

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(EMPLOYEE_ID))
    expect(toastMock.warning).toHaveBeenCalledWith(warning)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(refreshMock).toHaveBeenCalled()
  })

  it('cancels the separation after a confirmation that says released shifts stay open', async () => {
    cancelMock.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    renderOnNotice('2026-11-20')

    await user.click(screen.getByRole('button', { name: 'Cancel Separation' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/took them off every rota template/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Keep Separation' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel Separation' }))

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(EMPLOYEE_ID))
    expect(toastMock.success).toHaveBeenCalledWith('Separation cancelled. They stay on as Active. Add them back to their rota templates and shifts.')
    expect(refreshMock).toHaveBeenCalled()
  })
})

describe('EmployeeHolidaysTab allowance', () => {
  const rotaSettings = { holidayYearStartMonth: 1, holidayYearStartDay: 1, defaultHolidayDays: 2 }
  const day = (leave_date: string): EmployeeLeaveDay => ({
    request_id: 'leave-1',
    leave_date,
    status: 'approved',
    leave_type: 'annual',
    consumes_allowance: true,
  })

  it('says the allowance is used in full, not "0 days over allowance"', () => {
    render(
      <EmployeeHolidaysTab
        employeeId={EMPLOYEE_ID}
        canCreateLeave={false}
        leaveRequests={[]}
        leaveDays={[day('2026-03-02'), day('2026-03-03')]}
        paySettings={null}
        rotaSettings={rotaSettings}
      />,
    )

    expect(screen.getByText('Allowance used in full')).toBeInTheDocument()
    expect(screen.queryByText(/over allowance/)).not.toBeInTheDocument()
  })

  it('shows the onboarding answer about time off already booked', () => {
    render(
      <EmployeeHolidaysTab
        employeeId={EMPLOYEE_ID}
        canCreateLeave={false}
        leaveRequests={[]}
        leaveDays={[]}
        paySettings={null}
        rotaSettings={rotaSettings}
        onboardingTimeOff={{ answer: 'none', answeredAt: '2026-10-20T09:00:00Z' }}
      />,
    )

    expect(screen.getByText('At onboarding they said they had no time off already booked (answered 20 Oct 2026).')).toBeInTheDocument()
  })
})

describe('HealthRecordsTab and FinancialDetailsTab', () => {
  it('says the health record is withheld rather than showing every answer as "No"', () => {
    render(<HealthRecordsTab employeeId={EMPLOYEE_ID} healthRecord={null} canEdit={false} redacted />)

    expect(screen.getByText('You do not have permission to see the health record.')).toBeInTheDocument()
    expect(screen.queryByText('Has Allergies?')).not.toBeInTheDocument()
  })

  it('says when no health record exists', () => {
    render(<HealthRecordsTab employeeId={EMPLOYEE_ID} healthRecord={null} canEdit />)

    expect(screen.getByText('No health information has been recorded yet.')).toBeInTheDocument()
  })

  it('shows the recent treatment answer', () => {
    const record = { employee_id: EMPLOYEE_ID, recent_treatment: 'Physiotherapy in August' } as unknown as EmployeeHealthRecord
    render(<HealthRecordsTab employeeId={EMPLOYEE_ID} healthRecord={record} canEdit />)

    expect(screen.getByText('Recent Treatment')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy in August')).toBeInTheDocument()
  })

  it('says the financial details are withheld rather than showing "N/A"', () => {
    render(<FinancialDetailsTab employeeId={EMPLOYEE_ID} financialDetails={null} canEdit={false} redacted />)

    expect(screen.getByText('You do not have permission to see these details.')).toBeInTheDocument()
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })

  it('shows a failed load as an error', () => {
    render(
      <FinancialDetailsTab
        employeeId={EMPLOYEE_ID}
        financialDetails={null}
        canEdit
        loadError="The financial details could not be loaded."
      />,
    )

    expect(screen.getByText('Could not load financial details')).toBeInTheDocument()
    expect(screen.getByText('The financial details could not be loaded.')).toBeInTheDocument()
  })
})

describe('OnboardingChecklistTab', () => {
  beforeEach(() => {
    getOnboardingProgressMock.mockResolvedValue({
      data: {
        completed: 0,
        total: 2,
        percentage: 0,
        items: [
          { field: 'employee_agreement_accepted', label: 'Employee Agreement Accepted', completed: false, date: null },
          { field: 'till_system_setup', label: 'Till System Setup', completed: false, date: null },
        ],
        data: null,
      },
    })
  })

  it('leaves the agreement to the signing feature, even for an editor', async () => {
    render(<OnboardingChecklistTab employeeId={EMPLOYEE_ID} canEdit />)

    const agreement = (await screen.findByText('Employee Agreement Accepted')).closest('li')
    if (!agreement) throw new Error('No checklist item for the agreement')
    expect(within(agreement).getByRole('checkbox')).toBeDisabled()
    expect(within(agreement).getByText('Ticked automatically when the worker agreement is signed. Send it from the Signing tab.')).toBeInTheDocument()

    const till = (await screen.findByText('Till System Setup')).closest('li')
    if (!till) throw new Error('No checklist item for the till')
    expect(within(till).getByRole('checkbox')).toBeEnabled()
  })

  it('shows when the starter was told about the right to work check', async () => {
    render(<OnboardingChecklistTab employeeId={EMPLOYEE_ID} canEdit rightToWorkNoticeAt="2026-10-20T09:00:00Z" />)

    expect(await screen.findByText('Told about the right to work check')).toBeInTheDocument()
    expect(screen.getByText(/they confirmed during onboarding that they understand they cannot be given shifts/)).toBeInTheDocument()
  })
})

describe('EmployeeAuditTrail lifecycle entries', () => {
  function auditLog(overrides: Partial<AuditLogEntry>): AuditLogEntry {
    return {
      id: 'audit-1',
      created_at: '2026-11-02T10:00:00+00:00',
      user_email: 'manager@example.com',
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      operation_status: 'success',
      old_values: null,
      new_values: null,
      additional_info: null,
      ...overrides,
    }
  }

  it('shows a changed rate override with the new and old rate', () => {
    render(
      <EmployeeAuditTrail
        employeeId={EMPLOYEE_ID}
        canViewAudit
        auditLogs={[
          auditLog({
            additional_info: {
              action: 'update_rate_override',
              hourly_rate: 13.5,
              effective_from: '2026-11-23',
              previous_hourly_rate: 13,
              previous_effective_from: '2026-11-20',
            },
          }),
        ]}
      />,
    )

    expect(screen.getByText(/changed a pay rate override/)).toBeInTheDocument()
    expect(screen.getByText('Rate: £13.50/hr from 23 Nov 2026 • Was: £13.00/hr from 20 Nov 2026')).toBeInTheDocument()
  })

  it('shows an automatic Former whose login could not be deleted', () => {
    render(
      <EmployeeAuditTrail
        employeeId={EMPLOYEE_ID}
        canViewAudit
        auditLogs={[
          auditLog({
            operation_type: 'access_revoked',
            additional_info: { source: 'automatic', auth_user_deleted: false },
          }),
        ]}
      />,
    )

    expect(screen.getByText(/marked as Former and removed system access/)).toBeInTheDocument()
    expect(screen.getByText('Done automatically after the last working day • Their login could not be deleted')).toBeInTheDocument()
  })

  it('says when the history could not be loaded, rather than showing none', () => {
    render(
      <EmployeeAuditTrail
        employeeId={EMPLOYEE_ID}
        canViewAudit
        auditLogs={[]}
        loadError="The change history could not be loaded."
      />,
    )

    expect(screen.getByText('The change history could not be loaded.')).toBeInTheDocument()
  })
})
