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

function makeWarningLog(insert = vi.fn().mockResolvedValue({ error: null })) {
  return { insert }
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
      // The mirror to the live rota reads the row back so a vanished shift is
      // told apart from a failed write.
      return makeEqUpdateSelect(2, { data: { id: 'shift-auto' }, error: null })
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
          return makeWarningLog(emailLogInsert)
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

    }))
    expect(sendEmailMock.mock.calls[0][0]).not.toHaveProperty('cc')
    expect(rotaPublishedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      acceptance_status: 'auto_accepted',
      acceptance_decided_by: 'employee-2',
    }))
    expect(emailLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      email_type: 'shift_auto_accept_warning',
      cc_addresses: [],
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
          return makeWarningLog()
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

  it('holds a late-published shift through its 48-hour grace window, then auto-accepts it', async () => {
    // Decision D13: a shift FIRST published to somebody inside the two-week cutoff
    // is not auto-accepted straight away; they get 48 hours from publication to
    // turn it down. Shift 2026-06-14 09:00 London (08:00Z), so the deadline is
    // 2026-05-31T08:00Z. Published 2026-05-31T12:00Z, i.e. late, so the window
    // runs to 2026-06-02T12:00Z.
    const shifts = [
      {
        id: 'shift-late',
        week_id: 'week-1',
        employee_id: 'employee-2',
        shift_date: '2026-06-14',
        start_time: '09:00',
        end_time: '17:00',
        department: 'kitchen',
        name: 'Kitchen',
        auto_accept_warning_sent_at: null,
        first_published_at: '2026-05-31T12:00:00Z',
      },
    ]

    function mockClient() {
      const rotaPublishedUpdate = vi.fn(() => makeEqUpdateSelect(3))
      const rotaShiftsUpdate = vi.fn(() => makeEqUpdateSelect(2, { data: { id: 'shift-late' }, error: null }))
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
                  data: [{ employee_id: 'employee-2', first_name: 'Blake', last_name: 'Vale', email_address: 'blake@example.com' }],
                  error: null,
                }),
              }),
            }
          }
          if (table === 'rota_shifts') return { update: rotaShiftsUpdate }
          if (table === 'rota_email_log') return makeWarningLog()
          if (table === 'audit_logs') return makeWarningLog()
          throw new Error(`Unexpected table: ${table}`)
        }),
      })
      return { rotaPublishedUpdate }
    }

    // Inside the window: held, not auto-accepted.
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    const inside = mockClient()
    const heldResponse = await GET(new Request('http://localhost/api/cron/rota-shift-acceptance'))
    const heldPayload = await heldResponse.json()
    expect(heldPayload.autoAccepted).toBe(0)
    expect(heldPayload.heldForLatePublishGrace).toBe(1)
    expect(inside.rotaPublishedUpdate).not.toHaveBeenCalled()

    // Past the window: auto-accepted.
    vi.setSystemTime(new Date('2026-06-02T13:00:00Z'))
    mockClient()
    const acceptedResponse = await GET(new Request('http://localhost/api/cron/rota-shift-acceptance'))
    const acceptedPayload = await acceptedResponse.json()
    expect(acceptedPayload.autoAccepted).toBe(1)
    expect(acceptedPayload.heldForLatePublishGrace).toBe(0)
  })

  it('gives no grace to a shift published in good time', async () => {
    // The precondition that was missing from the server action: a shift published
    // BEFORE its deadline never earns a window, so it auto-accepts as normal.
    const shifts = [
      {
        id: 'shift-on-time',
        week_id: 'week-1',
        employee_id: 'employee-2',
        shift_date: '2026-06-14',
        start_time: '09:00',
        end_time: '17:00',
        department: 'kitchen',
        name: 'Kitchen',
        auto_accept_warning_sent_at: null,
        first_published_at: '2026-05-30T10:00:00Z',
      },
    ]

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
            update: vi.fn(() => makeEqUpdateSelect(3)),
          }
        }
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ employee_id: 'employee-2', first_name: 'Blake', last_name: 'Vale', email_address: 'blake@example.com' }],
                error: null,
              }),
            }),
          }
        }
        if (table === 'rota_shifts') return { update: vi.fn(() => makeEqUpdateSelect(2, { data: { id: 'shift-on-time' }, error: null })) }
        if (table === 'rota_email_log') return makeWarningLog()
        if (table === 'audit_logs') return makeWarningLog()
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/rota-shift-acceptance'))
    const payload = await response.json()
    expect(payload.autoAccepted).toBe(1)
    expect(payload.heldForLatePublishGrace).toBe(0)
  })
  // Managers no longer get a copy of these warnings: shifts awaiting acceptance are counted
  // in the weekly insights report. That includes a member of staff whose address is the
  // manager mailbox, who used to be skipped because the Friday report carried their copy.
  it.each(['alex@example.com', ' MANAGER@the-anchor.pub '])('warns %s directly with no manager copy', async (address) => {
    const shift = {
      id: 'shift-warning', week_id: 'week-1', employee_id: 'employee-1', shift_date: '2026-06-16',
      start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar', auto_accept_warning_sent_at: null,
    }
    const update = vi.fn(() => ({ in: vi.fn().mockResolvedValue({ error: null }) }))
    const insert = vi.fn().mockResolvedValue({ error: null })
    const tablesRead: string[] = []
    const shiftQuery: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'lte']) shiftQuery[method] = vi.fn(() => shiftQuery)
    shiftQuery.order = vi.fn().mockReturnValueOnce(shiftQuery).mockResolvedValueOnce({ data: [shift], error: null })
    createAdminClientMock.mockReturnValue({ from: (table: string) => {
      tablesRead.push(table)
      if (table === 'rota_published_shifts') return { ...shiftQuery, update }
      if (table === 'employees') return { select: () => ({ in: async () => ({ data: [{
        employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', email_address: address,
      }], error: null }) }) }
      if (table === 'rota_shifts') return { update }
      if (table === 'rota_email_log') return makeWarningLog(insert)
      throw new Error(`Unexpected table ${table}`)
    } })

    const response = await GET(new Request('https://example.test/api/cron/rota-shift-acceptance'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: address }))
    expect(sendEmailMock.mock.calls[0][0]).not.toHaveProperty('cc')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', cc_addresses: [], to_addresses: [address] }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ auto_accept_warning_sent_at: expect.any(String) }))
    expect(payload.warningEmailsSent).toBe(1)
    expect(payload).not.toHaveProperty('managerCopiesQueued')
    expect(payload).not.toHaveProperty('managerEmailError')
    // The manager mailbox setting is no longer read by this job.
    expect(tablesRead).not.toContain('system_settings')
  })

})
