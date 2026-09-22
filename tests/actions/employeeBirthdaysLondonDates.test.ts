// Birthday reminders and the birthday list around midnight, in both test zones.
//
// The reminder picks employees whose birthday is exactly a week away and prints the date it
// falls on. Both used the host clock, which on the UTC server is still yesterday from 00:00 to
// 00:59 British Summer Time, so in that hour the email named the wrong person and the wrong day.
// The cron runs at 08:00 London, so it was right in practice; these tests pin it to London dates
// anyway, and render the email from fixture data to prove nothing in it reads undefined, NaN or
// Invalid Date. sendEmail is mocked: nothing is sent.
//
// Instants are written in UTC so the file reads the same in both test zones: 23:30 UTC on
// 17 September 2026 is 00:30 BST on Friday 18 September in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmailMock = vi.hoisted(() => vi.fn())
const adminFromMock = vi.hoisted(() => vi.fn())
const sessionFromMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: sessionFromMock }) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: sendEmailMock }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))

import { getAllBirthdays, sendBirthdayRemindersInternal } from '@/app/actions/employee-birthdays'

// 00:30 BST on Friday 18 September 2026 in London; Thursday 17 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-17T23:30:00Z'
// 23:30 BST on Thursday 17 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-17T22:30:00Z'
// Winter control: 00:30 GMT on Thursday 15 January 2026, the same day in both zones.
const JUST_AFTER_MIDNIGHT_GMT = '2026-01-15T00:30:00Z'

function employee(id: number, firstName: string, dateOfBirth: string) {
  return {
    employee_id: `00000000-0000-4000-8000-00000000000${id}`,
    first_name: firstName,
    last_name: 'Rowe',
    preferred_name: null,
    job_title: 'Bar Staff',
    date_of_birth: dateOfBirth,
    email_address: `${firstName.toLowerCase()}@example.com`,
  }
}

function employeesQuery(rows: unknown[]) {
  const not = vi.fn().mockResolvedValue({ data: rows, error: null })
  const inStatus = vi.fn().mockReturnValue({ not })
  return { select: vi.fn().mockReturnValue({ in: inStatus }) }
}

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

type SentEmail = { to: string; subject: string; html: string; text: string }

async function sendReminders(rows: unknown[]): Promise<SentEmail | null> {
  adminFromMock.mockReturnValue(employeesQuery(rows))
  const result = await sendBirthdayRemindersInternal(7)
  expect(result).not.toHaveProperty('error')
  if (sendEmailMock.mock.calls.length === 0) return null
  expect(sendEmailMock).toHaveBeenCalledTimes(1)
  return sendEmailMock.mock.calls[0][0] as SentEmail
}

function expectCleanRender(email: SentEmail) {
  for (const body of [email.subject, email.html, email.text]) {
    expect(body).not.toMatch(/undefined|Invalid Date|NaN/)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  sendEmailMock.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('birthday reminder email', () => {
  const ALEX = employee(1, 'Alex', '1990-09-25') // Friday 25 September 2026
  const SAM = employee(2, 'Sam', '1990-09-24') // Thursday 24 September 2026

  it('names the employee a week away in London in the first hour of the day', async () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    const email = await sendReminders([ALEX, SAM])

    expect(email).not.toBeNull()
    expectCleanRender(email!)
    expect(email!.subject).toBe('Birthday Reminder: 1 upcoming birthday next week')
    expect(email!.html).toContain('<strong>Alex</strong>')
    expect(email!.html).not.toContain('<strong>Sam</strong>')
    expect(email!.html).toMatch(/Friday, September 25\s*<\/td>/)
    expect(email!.html).toContain('Turning 36')
    expect(email!.text).toContain('• Alex (Bar Staff)\n  Birthday: Friday, September 25\n  Turning: 36\n')
  })

  it('names the day before midnight in London', async () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    const email = await sendReminders([ALEX, SAM])

    expect(email).not.toBeNull()
    expectCleanRender(email!)
    expect(email!.html).toContain('<strong>Sam</strong>')
    expect(email!.html).not.toContain('<strong>Alex</strong>')
    expect(email!.text).toContain('• Sam (Bar Staff)\n  Birthday: Thursday, September 24\n  Turning: 36\n')
  })

  it('agrees in both zones in winter', async () => {
    at(JUST_AFTER_MIDNIGHT_GMT)
    const email = await sendReminders([employee(3, 'Jo', '1985-01-22')])

    expect(email).not.toBeNull()
    expectCleanRender(email!)
    expect(email!.text).toContain('• Jo (Bar Staff)\n  Birthday: Thursday, January 22\n  Turning: 41\n')
  })

  it('keeps a 29 February birthday on 1 March in other years', async () => {
    at('2027-02-22T08:00:00Z') // the 08:00 cron on Monday 22 February 2027
    const email = await sendReminders([employee(4, 'Leap', '2000-02-29')])

    expect(email).not.toBeNull()
    expectCleanRender(email!)
    expect(email!.text).toContain('• Leap (Bar Staff)\n  Birthday: Monday, March 1\n  Turning: 27\n')
  })

  it('sends nothing when nobody is exactly a week away', async () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(await sendReminders([SAM])).toBeNull()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('getAllBirthdays', () => {
  it('counts down from the London date in the first hour of the day', async () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    sessionFromMock.mockReturnValue(employeesQuery([
      employee(1, 'Today', '1990-09-18'),
      employee(2, 'Yesterday', '1990-09-17'),
    ]))

    const result = await getAllBirthdays()

    expect(result.birthdays?.map(b => [b.first_name, b.days_until_birthday, b.turning_age])).toEqual([
      ['Today', 0, 36],
      ['Yesterday', 364, 37],
    ])
  })
})
