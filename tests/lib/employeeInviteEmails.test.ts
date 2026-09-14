import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import {
  buildSeparationStartedEmail,
  sendChaseEmail,
  sendOnboardingCompleteEmail,
  sendPortalInviteEmail,
  sendWelcomeEmail,
} from '@/lib/email/employee-invite-emails'

const mockedSendEmail = sendEmail as unknown as Mock

/**
 * sendEmail catches its own errors and returns { success: false }. These helpers used to hand that
 * result back, so their callers could not tell a send from a failure: the invite actions reported
 * "Invite sent" and the chase cron stamped a chase that never went.
 */
describe('employee invite emails say when a send failed', () => {
  const sends: Array<[string, () => Promise<unknown>]> = [
    ['the welcome invite', () => sendWelcomeEmail('new-starter@example.com', 'https://example.com/onboarding/token')],
    ['the portal invite', () => sendPortalInviteEmail('staff@example.com', 'https://example.com/onboarding/token')],
    ['a chase reminder', () => sendChaseEmail('staff@example.com', 'https://example.com/onboarding/token', 3)],
    ['the onboarding complete note', () => sendOnboardingCompleteEmail('Alex Rowe', 'staff@example.com')],
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(sends)('%s throws the provider reason when the email does not go', async (_label, send) => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 503' })

    await expect(send()).rejects.toThrow('Resend 503')
  })

  it.each(sends)('%s resolves when the provider accepts it', async (_label, send) => {
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1' })

    await expect(send()).resolves.toMatchObject({ success: true })
  })

  it('names what failed when the provider gives no reason', async () => {
    mockedSendEmail.mockResolvedValue({ success: false })

    await expect(sendWelcomeEmail('new-starter@example.com', 'https://example.com/onboarding/token')).rejects.toThrow(
      'Failed to send the invite email.'
    )
  })
})

describe('employee separation emails', () => {
  it('builds a future-dated separation email with remaining shifts and process guidance', () => {
    const email = buildSeparationStartedEmail({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-15',
      todayIso: '2099-05-13',
      shiftPolicy: 'work_remaining',
      remainingShifts: [
        {
          shiftDate: '2099-05-14',
          startTime: '09:00',
          endTime: '17:00',
          department: 'bar',
        },
      ],
    })

    expect(email.subject).toBe('Formal separation process started - Orange Jelly Limited')
    expect(email.text).toContain("I am writing to confirm that we've started the formal process of separating you from Orange Jelly Limited")
    expect(email.text).toContain('Your last scheduled working day is Friday, 15 May 2099.')
    expect(email.text).toContain('Thursday, 14 May 2099, 9am - 5pm (Bar)')
    expect(email.text).toContain('You will be paid in the next normal pay cycle for any shifts worked')
    expect(email.text).toContain('I will provide your P45 once the next pay cycle is complete.')
    expect(email.text).toContain('Please return your keys and any company property')
    expect(email.text).toContain('unless Billy or I confirm otherwise')
    expect(email.text).toContain('Any questions during your shifts can be raised with Billy')
    expect(email.text).toContain('Anything relating to this process can be raised with me directly')
    expect(email.text).toContain('We wish you the best of luck for the future')
    expect(email.text).toContain('Kind regards,\nPeter & Billy')
    expect(email.cc).toContain('billy@orangejelly.co.uk')
    expect(email.text).not.toContain('Peter confirms')
    expect(email.text).not.toContain('I wish you the best of luck')
  })

  it('builds a past-dated separation email without a separation reason', () => {
    const email = buildSeparationStartedEmail({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-12',
      todayIso: '2099-05-13',
      shiftPolicy: 'work_remaining',
      remainingShifts: [],
    })

    expect(email.text).toContain('Your last working day was Tuesday, 12 May 2099.')
    expect(email.text).not.toContain('reason')
    expect(email.text).not.toContain('Notice given')
  })

  it('tells a released employee not to attend further shifts', () => {
    const email = buildSeparationStartedEmail({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-15',
      todayIso: '2099-05-13',
      shiftPolicy: 'release_remaining',
      remainingShifts: [{
        shiftDate: '2099-05-14',
        startTime: '09:00',
        endTime: '17:00',
        department: 'bar',
      }],
    })

    expect(email.text).toContain('You are not expected to attend any further scheduled shifts.')
    expect(email.text).not.toContain('Thursday, 14 May 2099, 9am - 5pm')
    expect(email.text).not.toContain('Please continue to attend')
  })
})
