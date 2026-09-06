import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const sendEmailMock = vi.fn()
const queueManagerReportEmailMock = vi.fn()
const authorizeCronRequestMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

vi.mock('@/lib/manager-report/queue', () => ({
  queueManagerReportEmail: (...args: unknown[]) => queueManagerReportEmailMock(...args),
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

function makeSystemSettings(email: string | null = 'manager@the-anchor.pub') {
  // The manager mailbox now comes from Rota Settings (spec F8, decision D15)
  // rather than a hard-coded address, so every mocked client needs this table.
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: email === null ? null : { value: email },
          error: null,
        }),
      }),
    }),
  }
}

function makeWarningLog(insert = vi.fn().mockResolvedValue({ error: null }), rows: Array<Record<string, unknown>> = []) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'like', 'order']) query[method] = vi.fn(() => query);
  query.limit = vi.fn(async () => ({ data: rows.filter(row => String(row.error_message).startsWith('manager-report-retry:')), error: null }));
  return {
    ...query,
    insert,
    upsert: vi.fn(async (row: Record<string, unknown>) => {
      if (!rows.some(existing => existing.id === row.id)) rows.push({ ...row });
      return { error: null };
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      let rowId: unknown;
      const updateQuery = {
        eq: vi.fn((field: string, value: unknown) => { if (field === 'id') rowId = value; return updateQuery; }),
        like: vi.fn(async () => {
          for (const row of rows) if (row.id === rowId) Object.assign(row, patch);
          return { error: null };
        }),
      };
      return updateQuery;
    }),
  };
}

describe('/api/cron/rota-shift-acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'email-1' })
    queueManagerReportEmailMock.mockResolvedValue({ success: true, queued: true })
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
        if (table === 'system_settings') {
          return makeSystemSettings()
        }

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
    expect(queueManagerReportEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      section: 'staff_shift_reminders',
      key: 'employee-1:shift-warning',
      to: 'manager@the-anchor.pub',
      subject: expect.stringContaining('Alex'),
      html: expect.stringContaining('09:00'),
    }))
    expect(payload.managerCopiesQueued).toBe(1)
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
        if (table === 'system_settings') {
          return makeSystemSettings()
        }

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
          if (table === 'system_settings') return makeSystemSettings()
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
        if (table === 'system_settings') return makeSystemSettings()
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
  it.each(['queue failure', 'same mailbox', 'shared mailbox queue failure', 'retry storage failure'])('keeps staff and manager delivery independent after %s', async (scenario) => {
    if (scenario.includes('failure')) queueManagerReportEmailMock.mockResolvedValue({ success: false, error: 'queue unavailable' })
    const shift = {
      id: 'shift-warning', week_id: 'week-1', employee_id: 'employee-1', shift_date: '2026-06-16',
      start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar', auto_accept_warning_sent_at: null,
    }
    const update = vi.fn(() => ({ in: vi.fn().mockResolvedValue({ error: null }) }))
    const insert = vi.fn().mockResolvedValue({ error: null })
    const retryRows: Array<Record<string, unknown>> = []
    const log = makeWarningLog(insert, retryRows)
    if (scenario === 'retry storage failure') log.upsert.mockRejectedValueOnce(new Error('Database unavailable'))
    const shiftQuery: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'lte']) shiftQuery[method] = vi.fn(() => shiftQuery)
    shiftQuery.order = vi.fn().mockReturnValueOnce(shiftQuery).mockResolvedValueOnce({ data: [shift], error: null })
    createAdminClientMock.mockReturnValue({ from: (table: string) => {
      if (table === 'system_settings') return makeSystemSettings()
      if (table === 'rota_published_shifts') return { ...shiftQuery, update }
      if (table === 'employees') return { select: () => ({ in: async () => ({ data: [{
        employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe',
        email_address: scenario.includes('mailbox') ? ' MANAGER@the-anchor.pub ' : 'alex@example.com',
      }], error: null }) }) }
      if (table === 'rota_shifts') return { update }
      if (table === 'rota_email_log') return log
      throw new Error(`Unexpected table ${table}`)
    } })
    const response = await GET(new Request('https://example.test/api/cron/rota-shift-acceptance'))
    const payload = await response.json()
    if (!scenario.includes('mailbox')) {
      expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'alex@example.com' }))
      expect(sendEmailMock.mock.calls[0][0]).not.toHaveProperty('cc')
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', cc_addresses: [] }))
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ auto_accept_warning_sent_at: expect.any(String) }))
      expect(payload.warningEmailsSent).toBe(1)
    } else {
      expect(sendEmailMock).not.toHaveBeenCalled()
      expect(insert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(payload.warningEmailsSent).toBe(0)
    }
    expect(payload.managerCopiesFailed).toBe(scenario.includes('failure') ? 1 : 0)
    expect(payload.managerCopiesQueued).toBe(scenario === 'same mailbox' ? 1 : 0)
    expect(payload.managerRetryStorageErrors).toBe(scenario === 'retry storage failure' ? 1 : 0)
    expect(response.status).toBe(scenario === 'retry storage failure' ? 500 : 200)
    if (scenario.includes('queue failure')) {
      expect(log.upsert).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed', to_addresses: ['manager@the-anchor.pub'], cc_addresses: [],
        error_message: expect.stringContaining('manager-report-retry:'),
      }), expect.any(Object))
      // The shift can leave the pending scan after acceptance, reassignment or deletion.
      // Its saved manager payload must still be recovered without another staff send.
      const originalQueuedInput = queueManagerReportEmailMock.mock.calls[0][0]
      queueManagerReportEmailMock.mockResolvedValue({ success: true, queued: true })
      sendEmailMock.mockClear()
      shiftQuery.order = vi.fn().mockReturnValueOnce(shiftQuery).mockResolvedValueOnce({ data: [], error: null })
      const retryResponse = await GET(new Request('https://example.test/api/cron/rota-shift-acceptance'))
      const retryPayload = await retryResponse.json()
      expect(sendEmailMock).not.toHaveBeenCalled()
      expect(queueManagerReportEmailMock).toHaveBeenLastCalledWith(originalQueuedInput)
      expect(retryPayload).toMatchObject({ warningEmailsSent: 0, managerCopiesQueued: 1, managerRetryStorageErrors: 0 })
      expect(retryRows[0]).toMatchObject({ status: 'failed', error_message: 'Manager report collection recovered; entry queued for Friday delivery.' })
    }
  })

})
