import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import {
  sendChaseEmail,
  sendOnboardingCompleteEmail,
  sendPortalInviteEmail,
  sendWelcomeEmail,
} from '@/lib/email/employee-invite-emails'

const mockedSendEmail = sendEmail as unknown as Mock
const LINK = 'https://management.example.com/onboarding/token-1'
// 15:15 UTC on 6 November 2026 is 3:15pm in London (GMT).
const EXPIRES_AT = '2026-11-06T15:15:00.000Z'

/** Every email is rendered with fixture data and must not show a broken value. */
function sentEmail(): { to: string; subject: string; text: string } {
  const call = mockedSendEmail.mock.calls.at(-1)?.[0] as { to: string; subject: string; text: string }
  expect(call).toBeTruthy()
  for (const broken of ['undefined', 'null', 'Invalid Date', 'NaN']) {
    expect(call.subject).not.toContain(broken)
    expect(call.text).not.toContain(broken)
  }
  return call
}

describe('employee invite email content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'm-1' })
  })

  it('lists every part of the form in the welcome email, and what to have ready', async () => {
    await sendWelcomeEmail('starter@example.com', LINK)
    const email = sentEmail()

    expect(email.text).toContain('The form has six parts')
    for (const part of [
      'Personal details',
      'Time off already booked',
      'Emergency contacts',
      'Financial details: your bank sort code and account number',
      'Health information',
      'Right to work',
    ]) {
      expect(email.text).toContain(part)
    }
    expect(email.text).toContain(LINK)
  })

  it('gives the real expiry in reminders, and says plainly that the last one is the last', async () => {
    await sendChaseEmail('starter@example.com', LINK, 3, EXPIRES_AT)
    const dayThree = sentEmail()
    expect(dayThree.subject).toBe('Reminder: Please Complete Your Profile')
    expect(dayThree.text).toContain('Your link stops working at 3:15pm on Friday, 6 November 2026.')

    await sendChaseEmail('starter@example.com', LINK, 6, EXPIRES_AT)
    const daySix = sentEmail()
    expect(daySix.subject).toBe('Last Reminder: Your Profile Link Expires Soon')
    expect(daySix.text).toContain('3:15pm on Friday, 6 November 2026')
    expect(daySix.text).toContain('ask your manager to send you a new one')
  })

  it('leaves the expiry out of a reminder when it is not known, rather than guessing', async () => {
    await sendChaseEmail('starter@example.com', LINK, 3)
    expect(sentEmail().text).not.toContain('stops working')
  })

  it('gives the real expiry in a portal invite reminder', async () => {
    await sendPortalInviteEmail('staff@example.com', LINK, EXPIRES_AT)
    expect(sentEmail().text).toContain('This link stops working at 3:15pm on Friday, 6 November 2026.')

    await sendPortalInviteEmail('staff@example.com', LINK)
    expect(sentEmail().text).toContain('This link will expire in 7 days.')
  })

  it('tells the manager about booked time off, the right to work check still to do, and an under-18 starter', async () => {
    await sendOnboardingCompleteEmail({
      employeeName: 'Sam Reed',
      employeeEmail: 'sam@example.com',
      profileUrl: 'https://management.example.com/employees/emp-1',
      timeOffAnswer: 'has_dates',
      timeOffBlocks: [
        { startDate: '2026-12-01', endDate: '2026-12-05', leaveType: 'holiday', note: 'Wedding' },
        { startDate: '2027-01-08', endDate: '2027-01-08', leaveType: 'unavailable', note: null },
      ],
      rightToWorkCheckedOn: null,
      ageIfUnder18: 17,
    })
    const email = sentEmail()

    expect(email.subject).toBe('Sam Reed has completed their profile')
    expect(email.text).toContain('- Tuesday, 1 December 2026 to Saturday, 5 December 2026 (holiday): Wedding')
    expect(email.text).toContain('- Friday, 8 January 2027 (cannot work, not holiday)')
    expect(email.text).toContain('Right to work: still to check.')
    expect(email.text).toContain('Under 18: they are 17.')
    expect(email.text).toContain('View their profile: https://management.example.com/employees/emp-1')
  })

  it('says nothing is booked, notes a recorded right to work check, and has no under-18 line for an adult', async () => {
    await sendOnboardingCompleteEmail({
      employeeName: 'Alex Rowe',
      employeeEmail: 'alex@example.com',
      timeOffAnswer: 'none',
      timeOffBlocks: [],
      rightToWorkCheckedOn: '2026-10-30',
      ageIfUnder18: null,
    })
    const email = sentEmail()

    expect(email.text).toContain('Time off already booked: none.')
    expect(email.text).toContain('Right to work: a check is recorded on their profile, dated Friday, 30 October 2026.')
    expect(email.text).not.toContain('Under 18')
  })

  it('says when their age could not be checked, rather than leaving the under-18 line out', async () => {
    await sendOnboardingCompleteEmail({
      employeeName: 'Alex Rowe',
      employeeEmail: 'alex@example.com',
      timeOffAnswer: 'none',
      timeOffBlocks: [],
      ageIfUnder18: null,
      ageUnknown: true,
    })
    const email = sentEmail()

    expect(email.text).toContain('Age: we could not check their date of birth.')
    expect(email.text).not.toContain('Under 18')
  })

  it('says when the right to work record could not be read, rather than "still to check"', async () => {
    await sendOnboardingCompleteEmail({
      employeeName: 'Alex Rowe',
      employeeEmail: 'alex@example.com',
      timeOffAnswer: 'none',
      timeOffBlocks: [],
      rightToWorkCheckedOn: null,
      rightToWorkUnknown: true,
    })
    const email = sentEmail()

    expect(email.text).toContain('Right to work: we could not read their record. Check it on their profile before their first shift.')
    expect(email.text).not.toContain('still to check')
  })

  it('says when the time off answer could not be read, rather than saying none', async () => {
    await sendOnboardingCompleteEmail({
      employeeName: 'Alex Rowe',
      employeeEmail: 'alex@example.com',
      timeOffAnswer: null,
      timeOffBlocks: [],
    })
    const email = sentEmail()
    expect(email.text).toContain('we could not read their answer')
    expect(email.text).not.toContain('Time off already booked: none')
  })
})
