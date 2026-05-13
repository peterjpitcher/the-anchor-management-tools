import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

import { buildSeparationStartedEmail } from '@/lib/email/employee-invite-emails'

describe('employee separation emails', () => {
  it('builds a future-dated separation email with remaining shifts and process guidance', () => {
    const email = buildSeparationStartedEmail({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-15',
      todayIso: '2099-05-13',
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
    expect(email.text).toContain('I have begun the formal process of separating you from Orange Jelly Limited')
    expect(email.text).toContain('Your last scheduled working day is Friday, 15 May 2099.')
    expect(email.text).toContain('Thursday, 14 May 2099, 9am - 5pm (Bar)')
    expect(email.text).toContain('You will be paid in the next normal pay cycle for any shifts worked')
    expect(email.text).toContain('I will provide your P45 once the next pay cycle is complete.')
    expect(email.text).toContain('Please return your keys and any company property')
    expect(email.text).toContain('unless Billy or I confirm otherwise')
    expect(email.text).toContain('Any questions during your shifts can be raised with Billy')
    expect(email.text).toContain('Anything relating to this process can be raised with me directly')
    expect(email.text).toContain('I wish you the best of luck for the future')
    expect(email.text).toContain('Kind regards,\nPeter')
    expect(email.text).not.toContain('Peter confirms')
    expect(email.text).not.toContain('We wish')
  })

  it('builds a past-dated separation email without a separation reason', () => {
    const email = buildSeparationStartedEmail({
      email: 'alex@example.com',
      employeeName: 'Alex Rowe',
      employmentEndDate: '2099-05-12',
      todayIso: '2099-05-13',
      remainingShifts: [],
    })

    expect(email.text).toContain('Your last working day was Tuesday, 12 May 2099.')
    expect(email.text).not.toContain('reason')
    expect(email.text).not.toContain('Notice given')
  })
})
