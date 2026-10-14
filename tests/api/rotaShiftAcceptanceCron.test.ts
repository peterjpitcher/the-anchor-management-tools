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

// A query chain whose every method returns itself and which resolves to `result` when awaited,
// for the shift listing, the warning claim (update, in, is, select) and the live rota mirror.
function thenableChain(result: { data?: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['in', 'is', 'eq', 'select', 'not', 'lte', 'order']) chain[method] = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
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
        return thenableChain({ data: [{ id: 'shift-warning' }], error: null })
      }
      return makeEqUpdateSelect(3)
    })
    const rotaShiftsUpdate = vi.fn((payload: Record<string, unknown>) => {
      if (payload.auto_accept_warning_sent_at) {
        return thenableChain({ error: null })
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
    const update = vi.fn(() => thenableChain({ data: [{ id: 'shift-warning' }], error: null }))
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

  it('reports a refused warning log row at error level and still marks the shift as warned', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shift = {
      id: 'shift-warning', week_id: 'week-1', employee_id: 'employee-1', shift_date: '2026-06-16',
      start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar', auto_accept_warning_sent_at: null,
    }
    const update = vi.fn(() => thenableChain({ data: [{ id: 'shift-warning' }], error: null }))
    const insert = vi.fn().mockResolvedValue({ error: { code: '23514', message: 'violates check constraint', details: null, hint: null } })
    const shiftQuery: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'lte']) shiftQuery[method] = vi.fn(() => shiftQuery)
    shiftQuery.order = vi.fn().mockReturnValueOnce(shiftQuery).mockResolvedValueOnce({ data: [shift], error: null })
    createAdminClientMock.mockReturnValue({ from: (table: string) => {
      if (table === 'rota_published_shifts') return { ...shiftQuery, update }
      if (table === 'employees') return { select: () => ({ in: async () => ({ data: [{
        employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', email_address: 'alex@example.com',
      }], error: null }) }) }
      if (table === 'rota_shifts') return { update }
      if (table === 'rota_email_log') return makeWarningLog(insert)
      throw new Error(`Unexpected table ${table}`)
    } })

    const response = await GET(new Request('https://example.test/api/cron/rota-shift-acceptance'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.warningEmailsSent).toBe(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ auto_accept_warning_sent_at: expect.any(String) }))
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_email_log] Log write failed'),
      expect.objectContaining({ emailType: 'shift_auto_accept_warning', entityId: 'shift-warning', code: '23514' }),
    )
    consoleError.mockRestore()
  })

})

// Claim-then-send for the auto-accept warning. The stamp used to be written after the email,
// so a failed write meant the same warning went out again at the next 07:30 run. These tests
// run the real cron against in-memory tables that keep their stamps between runs.
describe('/api/cron/rota-shift-acceptance warning claim', () => {
  type Row = Record<string, unknown>
  type DbError = { message: string; code?: string | null; details?: string | null; hint?: string | null }

  const STAMP = 'auto_accept_warning_sent_at'

  function warningShift(id: string): Row {
    return {
      id, week_id: 'week-1', employee_id: 'employee-1', shift_date: '2026-06-16',
      start_time: '09:00', end_time: '17:00', department: 'bar', name: 'Bar',
      auto_accept_warning_sent_at: null, first_published_at: null,
      status: 'scheduled', is_open_shift: false, acceptance_status: 'pending',
    }
  }

  function createFakeDb(options: { claimError?: DbError; failStampWritesAfterSend?: boolean } = {}) {
    const tables: Record<'rota_published_shifts' | 'rota_shifts', Row[]> = {
      rota_published_shifts: [warningShift('shift-a'), warningShift('shift-b')],
      rota_shifts: [warningShift('shift-a'), warningShift('shift-b')],
    }
    const stampWrites: Array<{ table: string; value: unknown; conditional: 'is-null' | 'eq-value' | 'none'; applied: number }> = []
    let sentThisRun = false

    sendEmailMock.mockImplementation(async () => {
      sentThisRun = true
      return { success: true, messageId: 'email-1' }
    })

    function query(table: 'rota_published_shifts' | 'rota_shifts') {
      const filters: Array<(row: Row) => boolean> = []
      let conditional: 'is-null' | 'eq-value' | 'none' = 'none'
      let patch: Row | null = null
      let returning = false

      const run = (): { data: unknown; error: DbError | null } => {
        const rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (!patch) return { data: rows.map(row => ({ ...row })), error: null }
        if (STAMP in patch) {
          if (conditional === 'is-null' && options.claimError) {
            stampWrites.push({ table, value: patch[STAMP], conditional, applied: 0 })
            return { data: null, error: options.claimError }
          }
          if (patch[STAMP] !== null && options.failStampWritesAfterSend && sentThisRun) {
            stampWrites.push({ table, value: patch[STAMP], conditional, applied: 0 })
            return { data: null, error: { message: 'connection reset', code: '08006' } }
          }
          stampWrites.push({ table, value: patch[STAMP], conditional, applied: rows.length })
        }
        for (const row of rows) Object.assign(row, patch)
        return { data: returning ? rows.map(row => ({ id: row.id })) : null, error: null }
      }

      const chain: Record<string, unknown> = {
        select: vi.fn(() => {
          if (patch) returning = true
          return chain
        }),
        update: vi.fn((values: Row) => {
          patch = values
          return chain
        }),
        eq: vi.fn((column: string, value: unknown) => {
          if (column === STAMP) conditional = 'eq-value'
          filters.push(row => row[column] === value)
          return chain
        }),
        is: vi.fn((column: string, value: unknown) => {
          if (column === STAMP) conditional = 'is-null'
          filters.push(row => row[column] === value)
          return chain
        }),
        in: vi.fn((column: string, values: unknown[]) => {
          filters.push(row => values.includes(row[column]))
          return chain
        }),
        not: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      }
      return chain
    }

    const emailLogInsert = vi.fn().mockResolvedValue({ error: null })
    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'rota_published_shifts' || table === 'rota_shifts') return query(table)
        if (table === 'employees') {
          return { select: () => ({ in: async () => ({ data: [{
            employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', email_address: 'alex@example.com',
          }], error: null }) }) }
        }
        if (table === 'rota_email_log') return makeWarningLog(emailLogInsert)
        throw new Error(`Unexpected table ${table}`)
      },
    })

    return {
      tables,
      stampWrites,
      async run() {
        sentThisRun = false
        const response = await GET(new Request('https://example.test/api/cron/rota-shift-acceptance'))
        return response.json()
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('claims the shifts, sends one warning and keeps the stamp on both tables', async () => {
    const db = createFakeDb()

    const payload = await db.run()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(payload.warningEmailsSent).toBe(1)
    expect(payload.warningEmailsFailed).toBe(0)
    expect(db.tables.rota_published_shifts.every(row => typeof row[STAMP] === 'string')).toBe(true)
    expect(db.tables.rota_shifts.every(row => typeof row[STAMP] === 'string')).toBe(true)
    // The published stamp was a conditional claim made before the send, never released.
    expect(db.stampWrites[0]).toEqual(expect.objectContaining({ table: 'rota_published_shifts', conditional: 'is-null', applied: 2 }))
    expect(db.stampWrites.filter(write => write.value === null)).toEqual([])
  })

  it('sends nothing when another run has already claimed the shifts', async () => {
    const db = createFakeDb()
    // The read sees the shifts unwarned, but by the claim another run has stamped them.
    const client = createAdminClientMock()
    let listed = false
    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'rota_published_shifts' && !listed) {
          listed = true
          const unwarned = db.tables.rota_published_shifts.map(row => ({ ...row }))
          for (const row of db.tables.rota_published_shifts) row[STAMP] = '2026-05-31T07:30:00.000Z'
          return thenableChain({ data: unwarned, error: null })
        }
        return client.from(table)
      },
    })

    const payload = await db.run()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(payload.warningEmailsSent).toBe(0)
    expect(payload.warningEmailsFailed).toBe(0)
    expect(db.tables.rota_published_shifts.every(row => row[STAMP] === '2026-05-31T07:30:00.000Z')).toBe(true)
  })

  it('sends nothing and reports the error when the claim is refused', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb({ claimError: { message: 'permission denied', code: '42501' } })

    const payload = await db.run()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(payload.warningEmailsSent).toBe(0)
    expect(payload.warningEmailsFailed).toBe(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_published_shifts] Claiming the auto-accept warning before sending it failed'),
      expect.objectContaining({ employeeId: 'employee-1', code: '42501' }),
    )
    consoleError.mockRestore()
  })

  it('releases the claim when the email definitely failed, so the next run sends it', async () => {
    const db = createFakeDb()
    sendEmailMock.mockResolvedValueOnce({ success: false, error: 'Email sending is currently suspended', code: 'email_suspended' })

    const first = await db.run()
    expect(first.warningEmailsFailed).toBe(1)
    expect(db.tables.rota_published_shifts.every(row => row[STAMP] === null)).toBe(true)
    expect(db.tables.rota_shifts.every(row => row[STAMP] === null)).toBe(true)
    expect(db.stampWrites.map(write => write.conditional)).toEqual(['is-null', 'eq-value'])

    const second = await db.run()
    expect(second.warningEmailsSent).toBe(1)
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    expect(db.tables.rota_published_shifts.every(row => typeof row[STAMP] === 'string')).toBe(true)
  })

  it('keeps the claim when the email outcome is unknown, and never retries it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb()
    sendEmailMock.mockResolvedValueOnce({ success: false, error: 'socket hang up', uncertain: true })

    const first = await db.run()
    expect(first.warningEmailsFailed).toBe(1)
    expect(db.tables.rota_published_shifts.every(row => typeof row[STAMP] === 'string')).toBe(true)
    expect(db.stampWrites.filter(write => write.value === null)).toEqual([])
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Auto-accept warning outcome unknown'),
      expect.objectContaining({ employeeId: 'employee-1', shiftCount: 2 }),
    )

    await db.run()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('sends the warning at most once across two runs when the stamp write after the send fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb({ failStampWritesAfterSend: true })

    await db.run()
    await db.run()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})
