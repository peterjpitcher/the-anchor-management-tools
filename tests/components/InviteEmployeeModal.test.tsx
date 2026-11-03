import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

const mockInvite = vi.fn()

vi.mock('@/app/actions/employeeInvite', () => ({
  inviteEmployee: (...args: unknown[]) => mockInvite(...args),
}))

import InviteEmployeeModal from '@/components/features/employees/InviteEmployeeModal'

const NOT_SENT =
  'The invite email could not be sent because the email service did not accept it. Nothing reached them and no employee record was made. Please try again later. If it keeps failing, check the email address.'
const MAY_HAVE_GONE =
  'We sent the invite to new-starter@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again. Their record has been kept, so you can resend the invite from their profile if it did not arrive.'

function renderModal() {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(<InviteEmployeeModal onClose={onClose} onSuccess={onSuccess} />)
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new-starter@example.com' } })
  fireEvent.change(screen.getByLabelText('Employment start date'), { target: { value: '2026-10-01' } })
  return { onClose, onSuccess }
}

describe('Invite Employee modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows staff why the invite did not go, and keeps the dialog open', async () => {
    mockInvite.mockResolvedValue({ type: 'error', message: NOT_SENT })
    const { onClose, onSuccess } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }))

    expect(await screen.findByText(NOT_SENT)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  // The invite may have gone and the record was kept: sending again would mean a second email.
  it('shows a may-have-gone warning with only Close, which then hands back the kept record', async () => {
    mockInvite.mockResolvedValue({ type: 'warning', message: MAY_HAVE_GONE, employeeId: 'employee-1' })
    const { onClose, onSuccess } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }))

    expect(await screen.findByText(MAY_HAVE_GONE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send Invite' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onSuccess).toHaveBeenCalledWith('employee-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('reports a sent invite and closes', async () => {
    mockInvite.mockResolvedValue({ type: 'success', message: 'Invite sent to new-starter@example.com.', employeeId: 'employee-1' })
    const { onClose, onSuccess } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('employee-1'))
    expect(toast.success).toHaveBeenCalledWith('Invite sent to new-starter@example.com.')
    expect(onClose).toHaveBeenCalled()
  })
})
