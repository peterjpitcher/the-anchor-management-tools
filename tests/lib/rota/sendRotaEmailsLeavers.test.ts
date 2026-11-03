// Rota emails go to current staff only. On 17 May 2026 someone on notice and past their last
// working day was emailed the next week's rota, because only the status was checked. On their
// last working day itself they are still current and still get it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const sendEmailMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

import { sendRotaWeekChangeEmails, sendRotaWeekEmails, type DiffShiftRow } from '@/lib/rota/send-rota-emails'

const LAST_DAY = '2026-11-07'
const WEEK_START = '2026-11-09'

const ADA = { employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, email_address: 'ada@example.com', status: 'Active', employment_end_date: null }
const SAM = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, email_address: 'sam@example.com', status: 'Started Separation', employment_end_date: LAST_DAY }

function query(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'not', 'order']) builder[method] = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function shift(employeeId: string, date: string): DiffShiftRow {
  return { id: `${employeeId}-${date}`, employee_id: employeeId, shift_date: date, start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar', is_open_shift: false, status: 'scheduled' }
}

function admin() {
  let publishedReads = 0
  return {
    from: (table: string) => {
      if (table === 'employees') return query({ data: [ADA, SAM], error: null })
      if (table === 'rota_published_shifts') {
        publishedReads += 1
        // Weekly email: first read is everyone's shifts, the second the open shifts.
        return query({
          data: publishedReads === 1 ? [shift('ada', WEEK_START), shift('sam', WEEK_START)] : [],
          error: null,
        })
      }
      if (table === 'rota_email_log') return { insert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

function recipients(): string[] {
  return sendEmailMock.mock.calls.map(([options]) => (options as { to: string }).to).sort()
}

function setLondonNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('rota emails and someone on notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'email-1' })
    createAdminClientMock.mockImplementation(admin)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the weekly rota to them on their last working day', async () => {
    setLondonNow(`${LAST_DAY}T10:00:00.000Z`)

    await expect(sendRotaWeekEmails('week-1', WEEK_START)).resolves.toEqual({ sent: 2, errors: 0 })
    expect(recipients()).toEqual(['ada@example.com', 'sam@example.com'])
  })

  it('does not send the weekly rota once their last working day has passed', async () => {
    // Sunday 8 November, the day the weekly cron runs.
    setLondonNow('2026-11-08T21:00:00.000Z')

    await expect(sendRotaWeekEmails('week-1', WEEK_START)).resolves.toEqual({ sent: 1, errors: 0 })
    expect(recipients()).toEqual(['ada@example.com'])
  })

  it('does not send a rota change email once their last working day has passed', async () => {
    setLondonNow('2026-11-08T21:00:00.000Z')
    const before = [shift('ada', WEEK_START), shift('sam', WEEK_START)]
    const after = [shift('ada', '2026-11-10'), shift('sam', '2026-11-10')]

    await expect(sendRotaWeekChangeEmails('week-1', WEEK_START, before, after)).resolves.toEqual({ sent: 1, errors: 0 })
    expect(recipients()).toEqual(['ada@example.com'])
  })

  it('sends a rota change email on their last working day', async () => {
    setLondonNow(`${LAST_DAY}T10:00:00.000Z`)
    const before = [shift('ada', WEEK_START), shift('sam', WEEK_START)]
    const after = [shift('ada', '2026-11-10'), shift('sam', '2026-11-10')]

    await expect(sendRotaWeekChangeEmails('week-1', WEEK_START, before, after)).resolves.toEqual({ sent: 2, errors: 0 })
  })
})
