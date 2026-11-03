// The Birthdays page button shows a reminder that may have reached the manager as a warning, not
// a red error (siblings review, 2 November 2026). "May have reached the manager" asks the person to
// check before sending again, which an error toast, read as "it failed, try again", undercut. Only
// a definite refusal is an error. The action is mocked: nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const sendBirthdayReminders = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/employee-birthdays', () => ({ sendBirthdayReminders }))
vi.mock('@/ds', async () => {
  const actual = await vi.importActual<typeof import('@/ds')>('@/ds')
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})

import { toast } from '@/ds'
import SendBirthdayRemindersButton from '@/components/features/employees/SendBirthdayRemindersButton'
import { BIRTHDAY_REMINDER_MESSAGES } from '@/lib/employees/birthday-reminders'

async function press() {
  render(<SendBirthdayRemindersButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Email Reminder for Birthdays in 7 Days' }))
  await waitFor(() => expect(sendBirthdayReminders).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Email Reminder for Birthdays in 7 Days' })).toBeEnabled())
}

function onlyWarning(): { message: string; duration: number } {
  expect(toast.warning).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  const [message, options] = (toast.warning as Mock).mock.calls[0]
  return { message, duration: (options as { duration: number }).duration }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SendBirthdayRemindersButton', () => {
  it('shows a send that may have gone as a long warning, not an error', async () => {
    sendBirthdayReminders.mockResolvedValue({ error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true })

    await press()

    const { message, duration } = onlyWarning()
    expect(message).toBe(BIRTHDAY_REMINDER_MESSAGES.uncertain)
    expect(duration).toBeGreaterThanOrEqual(10000)
  })

  it('shows a press while another run holds the reminder as a warning, not a success', async () => {
    const warning = BIRTHDAY_REMINDER_MESSAGES.inProgress('09:11')
    sendBirthdayReminders.mockResolvedValue({ warning })

    await press()

    const { message, duration } = onlyWarning()
    expect(message).toBe(warning)
    expect(duration).toBeGreaterThanOrEqual(10000)
  })

  it('warns when the reminder went but could not be recorded', async () => {
    const sent = `Birthday reminder sent for 1 employee, ${BIRTHDAY_REMINDER_MESSAGES.unrecorded}`
    sendBirthdayReminders.mockResolvedValue({ success: true, sent: 1, unrecorded: true, message: sent })

    await press()

    expect(onlyWarning().message).toBe(sent)
  })

  it('keeps a definite refusal as an error', async () => {
    sendBirthdayReminders.mockResolvedValue({ error: BIRTHDAY_REMINDER_MESSAGES.notSent })

    await press()

    expect(toast.error).toHaveBeenCalledWith(BIRTHDAY_REMINDER_MESSAGES.notSent)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('shows a sent reminder as a success', async () => {
    sendBirthdayReminders.mockResolvedValue({ success: true, sent: 1, message: 'Birthday reminder sent for 1 employee' })

    await press()

    expect(toast.success).toHaveBeenCalledWith('Birthday reminder sent for 1 employee')
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('never says "not sent" when the page did not hear back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sendBirthdayReminders.mockRejectedValue(new Error('Failed to fetch'))

    await press()

    const { message } = onlyWarning()
    expect(message).toMatch(/may or may not have gone/)
    expect(message).toMatch(/Check with the manager/)
    expect(message).not.toContain('Failed to fetch')
  })
})
