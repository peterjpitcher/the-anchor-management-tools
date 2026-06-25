import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const sendEmailMock = vi.fn()
const authorizeCronRequestMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (...args: unknown[]) => authorizeCronRequestMock(...args),
}))

import { GET } from '@/app/api/cron/rota-shift-acceptance/route'

function makeEqUpdate(depth: number) {
  let chain: unknown = Promise.resolve({ error: null })
  for (let index = 0; index < depth; index += 1) {
    chain = { eq: vi.fn().mockReturnValue(chain) }
  }
  return chain
}

function makeEqUpdateSelect(
  depth: number,
  result: { data: { id: string } | null; error: Error | null } = { data: { id: 'updated-shift' }, error: null },
) {
  let chain: unknown = {
    select: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue(result),
    }),
  }
  for (let index = 0; index < depth; index += 1) {
    chain = { eq: vi.fn().mockReturnValue(chain) }
  }
  return chain
}

describe('/api/cron/rota-shift-acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'email-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns staff before cutoff and auto-accepts shifts at the cutoff', async () => {
    const shifts = [
      {
        id: 'shift-warning',
        week_id: 'week-1',
        employee_id: 'employee-1',
        shift_date: '2026-06-16',
        start_time: '09:00',
        end_time: '17:00',
        department: 'bar',
        name: 'Bar',
        auto_accept_warning_sent_at: null,
      },
      {
        id: 'shift-auto',
        week_id: 'week-1',
        employee_id: 'employee-2',
        shift_date: '2026-06-14',
        start_time: '09:00',
        end_time: '17:00',
        department: 'kitchen',
        name: 'Kitchen',
        auto_accept_warning_sent_at: null,
      },
    ]

    const rotaPublishedUpdate = vi.fn((payload: Record<string, unknown>) => {
      if (payload.auto_accept_warning_sent_at) {
        return { in: vi.fn().mockResolvedValue({ error: null }) }
      }
      return makeEqUpdateSelect(3)
    })
    const rotaShiftsUpdate = vi.fn((payload: Record<string, unknown>) => {
      if (payload.auto_accept_warning_sent_at) {
        return { in: vi.fn().mockResolvedValue({ error: null }) }
      }
      return makeEqUpdate(2)
    })
    const emailLogInsert = vi.fn().mockResolvedValue({ error: null })
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'rota_published_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    not: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          order: vi.fn().mockResolvedValue({ data: shifts, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: rotaPublishedUpdate,
          }
        }

        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', email_address: 'alex@example.com' },
                  { employee_id: 'employee-2', first_name: 'Blake', last_name: 'Vale', email_address: 'blake@example.com' },
                ],
                error: null,
              }),
            }),
          }
        }

        if (table === 'rota_shifts') {
          return { update: rotaShiftsUpdate }
        }

        if (table === 'rota_email_log') {
          return { insert: emailLogInsert }
        }

        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/rota-shift-acceptance'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.warningEmailsSent).toBe(1)
    expect(payload.autoAccepted).toBe(1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alex@example.com',
      cc: ['manager@the-anchor.pub'],
    }))
    expect(rotaPublishedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      acceptance_status: 'auto_accepted',
      acceptance_decided_by: 'employee-2',
    }))
    expect(emailLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      email_type: 'shift_auto_accept_warning',
      cc_addresses: ['manager@the-anchor.pub'],
    }))
    expect(auditLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'auto_accept',
      resource_type: 'rota_shift',
      resource_id: 'shift-auto',
    }))
  })

  it('does not record a phantom auto-accept when the guarded update affects no rows', async () => {
    const shifts = [
      {
        id: 'shift-auto',
        week_id: 'week-1',
        employee_id: 'employee-2',
        shift_date: '2026-06-14',
        start_time: '09:00',
        end_time: '17:00',
        department: 'kitchen',
        name: 'Kitchen',
        auto_accept_warning_sent_at: null,
      },
    ]

    const rotaPublishedUpdate = vi.fn(() => makeEqUpdateSelect(3, { data: null, error: null }))
    const rotaShiftsUpdate = vi.fn(() => makeEqUpdate(2))
    const auditLogInsert = vi.fn().mockResolvedValue({ error: null })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'rota_published_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    not: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          order: vi.fn().mockResolvedValue({ data: shifts, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: rotaPublishedUpdate,
          }
        }

        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { employee_id: 'employee-2', first_name: 'Blake', last_name: 'Vale', email_address: 'blake@example.com' },
                ],
                error: null,
              }),
            }),
          }
        }

        if (table === 'rota_shifts') {
          return { update: rotaShiftsUpdate }
        }

        if (table === 'rota_email_log') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }

        if (table === 'audit_logs') {
          return { insert: auditLogInsert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/rota-shift-acceptance'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.autoAccepted).toBe(0)
    expect(payload.autoAcceptFailed).toBe(1)
    expect(rotaShiftsUpdate).not.toHaveBeenCalled()
    expect(auditLogInsert).not.toHaveBeenCalled()
  })
})
