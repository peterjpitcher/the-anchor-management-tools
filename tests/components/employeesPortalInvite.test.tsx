// The roster's Send Portal Invite button and what it shows for each invite outcome.
//
// A 'warning' means the invite may have gone (the email service took it and did not answer), or
// went with a catch. The button used to come back after an error-typed "Invite sent, but ... try
// again", so staff pressed it again and sent a second email.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendPortalInviteMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/PermissionContext', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))
vi.mock('@/app/actions/employeeExport', () => ({ exportEmployees: vi.fn() }))
vi.mock('@/app/actions/employeeInvite', () => ({ sendPortalInvite: sendPortalInviteMock, inviteEmployee: vi.fn() }))
vi.mock('@/ds', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ds')>()
  return { ...original, toast: toastMock }
})

import EmployeesClient from '@/app/(authenticated)/employees/_components/EmployeesClient'
import type { EmployeeRosterResult } from '@/app/actions/employeeQueries'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
})

beforeEach(() => {
  vi.clearAllMocks()
})

// One current employee with no portal login, so the row offers Send Portal Invite.
const roster: EmployeeRosterResult = {
  employees: [{
    employee_id: 'e1', first_name: 'Sam', last_name: 'Rowe', preferred_name: null, email_address: 'sam@example.com',
    job_title: 'Bar Staff', employment_start_date: '2026-01-01', status: 'Active', auth_user_id: null,
    holiday_days_current_year: 0,
  }],
  pagination: { page: 1, pageSize: 50, totalCount: 1, totalPages: 1 },
  statusCounts: { all: 1, active: 1, former: 0, onboarding: 0, startedSeparation: 0 },
  filters: { statusFilter: 'Active', searchTerm: '' },
}

const permissions = { canCreate: true, canExport: true, canEdit: true }

describe('Send Portal Invite on the roster', () => {
  it('warns, and does not offer the button again, when the invite may have gone', async () => {
    const user = userEvent.setup()
    const message =
      'We sent the portal invite to sam@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again. Any link they already had still works.'
    sendPortalInviteMock.mockResolvedValue({ type: 'warning', message })
    render(<EmployeesClient initialData={roster} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'Send Portal Invite' })[0])

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(message, expect.anything()))
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getAllByText('Check before resending').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Send Portal Invite' })).not.toBeInTheDocument()
  })

  it('shows an error and keeps the button when nothing was sent', async () => {
    const user = userEvent.setup()
    sendPortalInviteMock.mockResolvedValue({ type: 'error', message: 'The portal invite email could not be sent.' })
    render(<EmployeesClient initialData={roster} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'Send Portal Invite' })[0])

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('The portal invite email could not be sent.'))
    expect(screen.getAllByRole('button', { name: 'Send Portal Invite' }).length).toBeGreaterThan(0)
  })

  it('says the invite was sent', async () => {
    const user = userEvent.setup()
    sendPortalInviteMock.mockResolvedValue({ type: 'success', message: 'Portal invite sent to sam@example.com.' })
    render(<EmployeesClient initialData={roster} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'Send Portal Invite' })[0])

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Portal invite sent to sam@example.com.'))
    expect(screen.getAllByText('Invite sent').length).toBeGreaterThan(0)
  })
})
