// The birthday reminder email and who can send it.
//
// FF-52: names and job titles went into the HTML raw. FF-53: the sender, which has no permission
// check, was exported from a 'use server' file, so any login could call it from the browser.
// FF-54: the footer pointed to "employee settings" that do not exist. The email is rendered from
// fixture data; sendEmail is mocked, so nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmailMock = vi.hoisted(() => vi.fn())
const adminFromMock = vi.hoisted(() => vi.fn())
const permissionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: vi.fn() }) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: sendEmailMock }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: permissionMock }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))

import * as birthdayActions from '@/app/actions/employee-birthdays'
import { sendBirthdayRemindersInternal } from '@/lib/employees/birthday-reminders'
import { escapeHtml } from '@/lib/email/escape-html'

function employeesQuery(rows: unknown[]) {
  const not = vi.fn().mockResolvedValue({ data: rows, error: null })
  const inStatus = vi.fn().mockReturnValue({ not })
  return { select: vi.fn().mockReturnValue({ in: inStatus }) }
}

type SentEmail = { to: string; subject: string; html: string; text: string }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 09:00 UTC on Monday 2 November 2026, when the cron runs: a birthday on 9 November is a week away.
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  sendEmailMock.mockResolvedValue({ success: true })
  permissionMock.mockResolvedValue(true)
  adminFromMock.mockReturnValue(employeesQuery([
    {
      employee_id: '00000000-0000-4000-8000-000000000001',
      first_name: 'Sam',
      last_name: "O'Neil",
      preferred_name: '<img src=x onerror=alert(1)>',
      job_title: 'Bar & <b>Kitchen</b>',
      date_of_birth: '1990-11-09',
      email_address: null,
    },
  ]))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the birthday reminder email', () => {
  it('escapes names and job titles, and renders with nothing undefined, NaN or Invalid Date', async () => {
    const result = await sendBirthdayRemindersInternal(7)

    expect(result).toMatchObject({ success: true, sent: 1 })
    const email = sendEmailMock.mock.calls[0][0] as SentEmail
    for (const body of [email.subject, email.html, email.text]) {
      expect(body).not.toMatch(/undefined|Invalid Date|NaN/)
    }
    expect(email.html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>')
    expect(email.html).toContain('Bar &amp; &lt;b&gt;Kitchen&lt;/b&gt;')
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).not.toContain('<b>Kitchen</b>')
    expect(email.html).toMatch(/Monday 9 November\s*<\/td>/)
    expect(email.html).toContain('Turning 36')
  })

  it('does not point to employee settings that do not exist', async () => {
    await sendBirthdayRemindersInternal(7)

    const email = sendEmailMock.mock.calls[0][0] as SentEmail
    expect(email.html).not.toMatch(/employee settings/i)
    expect(email.text).not.toMatch(/employee settings/i)
  })
})

describe('who can send it', () => {
  it('is not exported from the server action file, where any login could call it', () => {
    expect(Object.keys(birthdayActions)).not.toContain('sendBirthdayRemindersInternal')
  })

  it('needs employees:manage from the page, and sends nothing without it', async () => {
    permissionMock.mockResolvedValue(false)

    const result = await birthdayActions.sendBirthdayReminders()

    expect(result).toEqual({ error: 'You do not have permission to send birthday reminders' })
    expect(permissionMock).toHaveBeenCalledWith('employees', 'manage')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('sends from the page with employees:manage', async () => {
    const result = await birthdayActions.sendBirthdayReminders()

    expect(result).toMatchObject({ success: true, sent: 1 })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter in HTML text and attributes', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
  })
})
