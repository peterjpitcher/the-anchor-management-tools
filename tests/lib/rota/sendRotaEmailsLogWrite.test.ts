import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const sendEmailMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

import { sendRotaWeekEmails } from '@/lib/rota/send-rota-emails'

/** A query builder whose every filter returns itself and which resolves to `result`. */
function query(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'not', 'order']) builder[method] = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

describe('sendRotaWeekEmails log write', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'email-1' })
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('counts the email as sent and reports the refused log row at error level', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23514', message: 'violates check constraint', details: null, hint: null } })
    let publishedReads = 0
    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'employees') {
          return query({
            data: [{ employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', preferred_name: null, email_address: 'alex@example.com' }],
            error: null,
          })
        }
        if (table === 'rota_published_shifts') {
          publishedReads += 1
          // First read: the employee's shifts. Second read: open shifts.
          return query({
            data: publishedReads === 1
              ? [{ employee_id: 'employee-1', shift_date: '2026-10-19', start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar', is_open_shift: false }]
              : [],
            error: null,
          })
        }
        if (table === 'rota_email_log') return { insert }
        throw new Error(`Unexpected table ${table}`)
      },
    })

    const result = await sendRotaWeekEmails('week-1', '2026-10-19')

    expect(result).toEqual({ sent: 1, errors: 0 })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ email_type: 'staff_rota', status: 'sent' }))
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_email_log] Log write failed'),
      expect.objectContaining({ emailType: 'staff_rota', entityId: 'week-1', code: '23514' }),
    )
  })
})
