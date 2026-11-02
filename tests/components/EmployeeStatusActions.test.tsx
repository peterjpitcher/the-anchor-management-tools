import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmployeeStatusActions from '@/components/features/employees/EmployeeStatusActions'

const previewMock = vi.hoisted(() => vi.fn())
const beginMock = vi.hoisted(() => vi.fn())
const cancelMock = vi.hoisted(() => vi.fn())
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
  cancelEmployeeSeparation: cancelMock,
}))

vi.mock('@/app/actions/employeeInvite', () => ({
  resendInvite: resendMock,
  revokeEmployeeAccess: revokeMock,
}))

// The real design-system components render the dialogs (DS Modal and ConfirmDialog); only the
// toast is replaced so the tests can read what was announced.
vi.mock('@/ds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ds')>()),
  toast: toastMock,
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const preview = {
  employmentStartDate: '2026-01-01',
  futureLeaveDates: ['2026-10-05'],
  pendingLeaveDates: [] as string[],
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
      employmentEndDate={null}
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

    expect(screen.getByText('Loading scheduled shifts…')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' })).toBeDisabled()

    resolvePreview({ success: true, data: preview })

    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Auto accepted')).toBeInTheDocument()
    expect(screen.getByText(/Sunday, 20 September 2026/)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' })).toBeDisabled()
  })

  it('shows the shift choices as unavailable when the remaining rota cannot load', async () => {
    previewMock.mockResolvedValue({ success: false, error: 'Could not load the remaining shifts.' })
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))

    expect(await screen.findByText('Could not load the remaining shifts.')).toBeInTheDocument()
    for (const name of ['Work agreed shifts', 'Release all remaining shifts']) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeDisabled()
      // The DS Radio dims its label only from its own prop, not from the disabled fieldset.
      expect(screen.getByText(name)).toHaveClass('opacity-50')
    }
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' })).toBeDisabled()
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
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' })).toBeEnabled()
  })

  // begin_employee_separation clears their template assignments under both choices, which the
  // dialog never said: a manager keeping them on for their notice was not told their usual slots
  // would come out of weeks built from the templates.
  it('says starting takes them off every rota template, whichever option is chosen', async () => {
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))
    await screen.findByText('Published')
    const dialog = screen.getByRole('dialog')

    for (const option of [/Work agreed shifts/, /Release all remaining shifts/]) {
      await user.click(within(dialog).getByRole('radio', { name: option }))
      expect(within(dialog).getByText(/takes them off every rota template straight away, whichever option you choose/)).toBeInTheDocument()
      expect(within(dialog).getByText(/Cancelling the separation later does not put them back on the templates/)).toBeInTheDocument()
    }
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
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' })).toBeDisabled()
  })

  it('releases all remaining shifts and refreshes after an email warning', async () => {
    const warning = 'Separation was started and the rota was updated. We sent the separation email to alex@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again.'
    beginMock.mockResolvedValue({
      success: true,
      retainedShiftCount: 0,
      releasedShiftCount: 2,
      warning,
    })
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Begin Separation' }))
    await screen.findByText('Published')
    fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-09-20' } })
    await user.click(screen.getByRole('radio', { name: /Release all remaining shifts/ }))

    expect(screen.getByText('0 shifts will stay assigned. 2 shifts will become open.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Begin Separation' }))

    await waitFor(() => {
      expect(beginMock).toHaveBeenCalledWith(EMPLOYEE_ID, {
        employmentEndDate: '2026-09-20',
        shiftPolicy: 'release_remaining',
        note: undefined,
      })
    })
    // Long enough to read what to check before sending it again.
    expect(toastMock.warning).toHaveBeenCalledWith(warning, { duration: 10000 })
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(refreshMock).toHaveBeenCalledOnce()
  })
})

describe('EmployeeStatusActions resend invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderOnboarding() {
    return render(
      <EmployeeStatusActions
        employeeId={EMPLOYEE_ID}
        status="Onboarding"
        canEdit
        employmentStartDate={null}
        employmentEndDate={null}
      />,
    )
  }

  // A warning means it may have gone (an email we could not confirm), so it is neither a success
  // nor a failure to send again.
  it('shows a warning, not a success or an error, when the invite may have gone', async () => {
    const message = 'We could not confirm the invite email went. It may have reached them, so check with them before sending it again.'
    resendMock.mockResolvedValue({ type: 'warning', message })
    const user = userEvent.setup()
    renderOnboarding()

    await user.click(screen.getByRole('button', { name: 'Resend Invite' }))

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(message, { duration: 10000 }))
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
    // Nothing sends it again on its own.
    expect(resendMock).toHaveBeenCalledOnce()
  })

  // No answer from the server is not proof the email did not go, so it is not reported as a
  // failure to send again.
  it('says it cannot tell, rather than that it failed, when the request itself fails', async () => {
    resendMock.mockRejectedValue(new Error('Failed to fetch'))
    const user = userEvent.setup()
    renderOnboarding()

    await user.click(screen.getByRole('button', { name: 'Resend Invite' }))

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(
      'We could not tell whether the invite was resent. Check with them before sending it again.',
      { duration: 10000 },
    ))
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(resendMock).toHaveBeenCalledOnce()
  })

  it('shows success and error as before', async () => {
    resendMock.mockResolvedValueOnce({ type: 'success', message: 'Invite resent.' })
    resendMock.mockResolvedValueOnce({ type: 'error', message: 'Failed to resend invite.' })
    const user = userEvent.setup()
    renderOnboarding()

    await user.click(screen.getByRole('button', { name: 'Resend Invite' }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Invite resent.'))

    await user.click(screen.getByRole('button', { name: 'Resend Invite' }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to resend invite.'))
    expect(toastMock.warning).not.toHaveBeenCalled()
  })
})

describe('EmployeeStatusActions cancel separation wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderOnNotice(separationShiftPolicy?: string | null) {
    return render(
      <EmployeeStatusActions
        employeeId={EMPLOYEE_ID}
        status="Started Separation"
        canEdit
        employmentStartDate="2026-01-01"
        employmentEndDate="2099-12-05"
        separationShiftPolicy={separationShiftPolicy}
      />,
    )
  }

  async function openCancel() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel Separation' }))
    return { user, dialog: screen.getByRole('dialog') }
  }

  it('says the shifts up to the last day are still theirs under work agreed shifts', async () => {
    renderOnNotice('work_remaining')
    const { dialog } = await openCancel()

    expect(within(dialog).getByText(/kept their shifts up to the last working day, which are still theirs, but released any later shifts/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/released all their remaining shifts/)).not.toBeInTheDocument()
  })

  it('says every remaining shift was released when they were all released', async () => {
    renderOnNotice('release_remaining')
    const { dialog } = await openCancel()

    expect(within(dialog).getByText(/released all their remaining shifts to open shifts and took them off every rota template/)).toBeInTheDocument()
  })

  it('claims nothing about which shifts went when it does not know the policy, and shows the server toast', async () => {
    const message = 'Separation cancelled. They stay on as Active and keep their shifts up to the old last working day. Reassign any later shifts still wanted and add them back to their rota templates.'
    cancelMock.mockResolvedValue({ success: true, message })
    renderOnNotice()
    const { user, dialog } = await openCancel()

    expect(within(dialog).getByText(/Any shifts released when the separation started stay open/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/released all their remaining shifts/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel Separation' }))

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(EMPLOYEE_ID))
    expect(toastMock.success).toHaveBeenCalledWith(message)
    expect(refreshMock).toHaveBeenCalled()
  })
})
