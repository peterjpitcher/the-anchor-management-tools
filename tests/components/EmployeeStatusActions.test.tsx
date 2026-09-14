import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes } from 'react'
import EmployeeStatusActions from '@/components/features/employees/EmployeeStatusActions'

const previewMock = vi.hoisted(() => vi.fn())
const beginMock = vi.hoisted(() => vi.fn())
const resendMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

vi.mock('@/app/actions/employeeSeparation', () => ({
  getEmployeeSeparationPreview: previewMock,
  beginEmployeeSeparation: beginMock,
}))

vi.mock('@/app/actions/employeeInvite', () => ({
  resendInvite: resendMock,
  revokeEmployeeAccess: revokeMock,
}))

vi.mock('@/ds', () => ({
  Button: ({ loading: _loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props} />
  ),
  toast: toastMock,
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const preview = {
  employmentStartDate: '2026-01-01',
  futureLeaveDates: ['2026-10-05'],
  shifts: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      weekId: '00000000-0000-4000-8000-000000000021',
      shiftDate: '2026-09-20',
      startTime: '12:00:00',
      endTime: '17:00:00',
      department: 'bar',
      name: 'Lunch',
      weekStatus: 'published' as const,
      acceptanceStatus: 'auto_accepted' as const,
    },
    {
      id: '00000000-0000-4000-8000-000000000012',
      weekId: '00000000-0000-4000-8000-000000000022',
      shiftDate: '2026-10-01',
      startTime: '18:00:00',
      endTime: '20:00:00',
      department: 'training',
      name: null,
      weekStatus: 'draft' as const,
      acceptanceStatus: 'pending' as const,
    },
  ],
}

function renderActions(employmentStartDate = '2026-01-01') {
  return render(
    <EmployeeStatusActions
      employeeId={EMPLOYEE_ID}
      status="Active"
      canEdit
      employmentStartDate={employmentStartDate}
    />,
  )
}

describe('EmployeeStatusActions separation review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    previewMock.mockResolvedValue({ success: true, data: preview })
    beginMock.mockResolvedValue({
      success: true,
      retainedShiftCount: 1,
      releasedShiftCount: 1,
    })
  })

  it('loads and shows the full shift preview before a decision can be confirmed', async () => {
    let resolvePreview: (value: { success: true; data: typeof preview }) => void = () => undefined
    previewMock.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve }))
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))

    expect(screen.getByText('Loading scheduled shifts...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm separation' })).toBeDisabled()

    resolvePreview({ success: true, data: preview })

    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Auto accepted')).toBeInTheDocument()
    expect(screen.getByText(/Sunday, 20 September 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm separation' })).toBeDisabled()
  })

  it('shows the retained and released split for work agreed shifts', async () => {
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))
    await screen.findByText('Published')
    fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-09-25' } })
    await user.click(screen.getByRole('radio', { name: /Work agreed shifts/ }))

    expect(screen.getByText('1 shift will stay assigned. 1 shift will become open.')).toBeInTheDocument()
    expect(screen.getAllByText('Will stay assigned')).toHaveLength(1)
    expect(screen.getAllByText('Will become open')).toHaveLength(1)
    expect(screen.getByText(/1 approved leave day after the last working day/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm separation' })).toBeEnabled()
  })

  it('blocks an end date which is not after employment started', async () => {
    previewMock.mockResolvedValue({
      success: true,
      data: { ...preview, employmentStartDate: '2026-09-16' },
    })
    const user = userEvent.setup()
    renderActions('2026-09-16')

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))
    await screen.findByText('Published')
    fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-09-16' } })
    await user.click(screen.getByRole('radio', { name: /Release all remaining shifts/ }))

    expect(screen.getByText(/Last working day must be after Wednesday, 16 September 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm separation' })).toBeDisabled()
  })

  it('releases all remaining shifts and refreshes after an email warning', async () => {
    beginMock.mockResolvedValue({
      success: true,
      retainedShiftCount: 0,
      releasedShiftCount: 2,
      warning: 'Separation was started, but the email failed.',
    })
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))
    await screen.findByText('Published')
    fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-09-20' } })
    await user.click(screen.getByRole('radio', { name: /Release all remaining shifts/ }))

    expect(screen.getByText('0 shifts will stay assigned. 2 shifts will become open.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm separation' }))

    await waitFor(() => {
      expect(beginMock).toHaveBeenCalledWith(EMPLOYEE_ID, {
        employmentEndDate: '2026-09-20',
        shiftPolicy: 'release_remaining',
        note: undefined,
      })
    })
    expect(toastMock.warning).toHaveBeenCalledWith('Separation was started, but the email failed.')
    expect(refreshMock).toHaveBeenCalledOnce()
  })
})
