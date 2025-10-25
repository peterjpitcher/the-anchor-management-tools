import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SmsQueueActionForm, type SmsQueueActionState } from '@/components/private-bookings/SmsQueueActionForm'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  promise: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/components/ui-v2/feedback/Toast', () => ({
  toast,
  Toaster: () => null,
}))

describe('SmsQueueActionForm', () => {
  const confirmSpy = () => vi.spyOn(window, 'confirm')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a success toast when the action completes', async () => {
    const action = vi.fn(async (_state: SmsQueueActionState, formData: FormData) => {
      expect(formData.get('smsId')).toBe('sms-123')
      return { status: 'success', changedAt: Date.now() }
    })

    const confirm = confirmSpy().mockReturnValue(true)

    render(
      <SmsQueueActionForm
        action={action}
        smsId="sms-123"
        confirmMessage="Approve?"
        successMessage="Approved!"
      >
        Approve
      </SmsQueueActionForm>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Approved!')
    })
  })

  it('surfaces errors from the action', async () => {
    const action = vi.fn(async () => ({
      status: 'error' as const,
      message: 'Permission denied',
      changedAt: Date.now(),
    }))

    confirmSpy().mockReturnValue(true)

    render(
      <SmsQueueActionForm
        action={action}
        smsId="sms-456"
        confirmMessage="Reject?"
        successMessage="Rejected"
      >
        Reject
      </SmsQueueActionForm>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Permission denied')
    })
  })

  it('prevents submission when disabled', () => {
    const action = vi.fn()
    const confirm = confirmSpy().mockReturnValue(true)

    render(
      <SmsQueueActionForm
        action={action}
        smsId="sms-789"
        confirmMessage="Send?"
        successMessage="Sent"
        disabled
      >
        Send Now
      </SmsQueueActionForm>
    )

    const button = screen.getByRole('button', { name: 'Send Now' })
    expect(button).toBeDisabled()

    fireEvent.click(button)

    expect(action).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})
