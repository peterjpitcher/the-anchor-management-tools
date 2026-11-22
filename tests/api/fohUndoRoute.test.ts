import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getBooking: vi.fn(),
  canComeBack: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: mocks.permission }))
vi.mock('@/lib/foh/bookings', () => ({ getTableBookingForFoh: mocks.getBooking }))
vi.mock('@/lib/table-bookings/reinstate-check', () => ({ checkNoShowCanComeBack: mocks.canComeBack }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { NextRequest } from 'next/server'
import { POST as undo } from '@/app/api/foh/bookings/[id]/undo/route'
import { POST as left } from '@/app/api/foh/bookings/[id]/left/route'

/**
 * Undo on the floor screen (owner decision, 22 November 2026). The one that matters most: a party
 * marked as left by mistake gets its table back for the time it had, unless someone else has been
 * given that table meanwhile, in which case nothing is changed and staff are told.
 */

const ID = '00000000-0000-4000-8000-000000000001'
const TABLE = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-000000000002'
// Booked 19:00 to 21:00, marked as left at 19:30, undone ten seconds later.
const START = '2026-11-21T19:00:00.000Z'
const PLANNED_END = '2026-11-21T21:00:00.000Z'
const LEFT_AT = '2026-11-21T19:30:00.000Z'
const NOW = '2026-11-21T19:30:10.000Z'

type Filters = Array<[string, string, unknown]>
type Write = { table: string; values: Record<string, unknown>; filters: Filters }

/**
 * A small in-memory stand-in: reads answer by table, and every update is recorded with its
 * filters. `refuseAssignmentUpdate` plays the database's overlap trigger.
 */
function buildDb(options: {
  booking?: Record<string, unknown> | null
  myAssignments?: Array<Record<string, unknown>>
  otherAssignments?: Array<Record<string, unknown>>
  otherBookings?: Array<Record<string, unknown>>
  refuseAssignmentUpdate?: boolean
  bookingUpdateMatches?: boolean
}) {
  const writes: Write[] = []
  const from = (table: string) => {
    const filters: Filters = []
    let mode: 'select' | 'update' = 'select'
    let values: Record<string, unknown> = {}
    const result = () => {
      if (mode === 'update') {
        writes.push({ table, values, filters: [...filters] })
        if (table === 'booking_table_assignments') {
          const extending = Date.parse(String(values.end_datetime)) > Date.parse(LEFT_AT)
          return { data: null, error: options.refuseAssignmentUpdate && extending ? { message: 'table_assignment_overlap' } : null }
        }
        return {
          data: options.bookingUpdateMatches === false ? null : { id: ID, status: 'confirmed', left_at: null, ...values },
          error: null,
        }
      }
      if (table === 'booking_table_assignments') {
        const mine = filters.some(([op, column]) => op === 'eq' && column === 'table_booking_id')
        return { data: mine ? options.myAssignments ?? [] : options.otherAssignments ?? [], error: null }
      }
      const byId = filters.some(([op, column]) => op === 'eq' && column === 'id')
      return { data: byId ? options.booking ?? null : options.otherBookings ?? [], error: null }
    }
    const builder: Record<string, unknown> = {}
    for (const op of ['eq', 'neq', 'lt', 'gt', 'is', 'in', 'not']) {
      builder[op] = (column: string, value: unknown) => { filters.push([op, column, value]); return builder }
    }
    builder.select = () => builder
    builder.update = (next: Record<string, unknown>) => { mode = 'update'; values = next; return builder }
    builder.maybeSingle = async () => result()
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return builder
  }
  return { supabase: { from }, writes }
}

const leftBooking = { id: ID, status: 'confirmed', left_at: LEFT_AT, end_datetime: LEFT_AT }
const shortened = [{ table_id: TABLE, start_datetime: START, end_datetime: LEFT_AT }]
const leftTicket = {
  action: 'left',
  stamp: LEFT_AT,
  restore: { end_datetime: PLANNED_END, assignments: [{ table_id: TABLE, end_datetime: PLANNED_END }] },
}
const nextParty = {
  otherAssignments: [{ table_id: TABLE, table_booking_id: OTHER, start_datetime: '2026-11-21T19:45:00.000Z', end_datetime: '2026-11-21T21:30:00.000Z' }],
}

async function callUndo(body: unknown) {
  const response = await undo(
    new NextRequest(`http://localhost/api/foh/bookings/${ID}/undo`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ID }) }
  )
  return { status: response.status, body: await response.json() }
}

function signIn(db: { supabase: unknown }) {
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db.supabase })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

describe('marking a booking as left answers with what an Undo needs', () => {
  it('reports the booking end and the table times it is about to cut', async () => {
    vi.setSystemTime(new Date(LEFT_AT))
    const db = buildDb({ myAssignments: [{ table_id: TABLE, end_datetime: '2026-11-21T21:00:00+00:00' }] })
    signIn(db)
    mocks.getBooking.mockResolvedValue({
      id: ID, status: 'confirmed', seated_at: START, start_datetime: START, end_datetime: PLANNED_END,
      booking_date: '2026-11-21', booking_time: '19:00',
    })

    const response = await left(new NextRequest(`http://localhost/api/foh/bookings/${ID}/left`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.undo).toEqual(leftTicket)
  })
})

describe('undoing Left gives the table its time back', () => {
  it('restores the table times and the booking end, and clears left', async () => {
    const db = buildDb({ booking: leftBooking, myAssignments: shortened })
    signIn(db)

    const { status } = await callUndo(leftTicket)

    expect(status).toBe(200)
    const assignmentWrite = db.writes.find((write) => write.table === 'booking_table_assignments')
    expect(assignmentWrite?.values).toEqual({ end_datetime: PLANNED_END })
    expect(assignmentWrite?.filters).toContainEqual(['eq', 'table_id', TABLE])
    const bookingWrite = db.writes.find((write) => write.table === 'table_bookings')
    expect(bookingWrite?.values).toMatchObject({ left_at: null, end_datetime: PLANNED_END })
    // Guarded on the stamp the leave wrote, so it cannot overwrite a later change.
    expect(bookingWrite?.filters).toContainEqual(['eq', 'left_at', LEFT_AT])
  })

  it('refuses, and changes nothing, when the table has been given to someone else', async () => {
    const db = buildDb({
      booking: leftBooking,
      myAssignments: shortened,
      ...nextParty,
      otherBookings: [{ id: OTHER, booking_reference: 'TB-NEXT', status: 'confirmed', left_at: null }],
    })
    signIn(db)

    const { status, body } = await callUndo(leftTicket)

    expect(status).toBe(409)
    expect(body.error).toContain('TB-NEXT')
    expect(body.error).toContain('still marked as left')
    expect(db.writes).toHaveLength(0)
  })

  it('ignores a booking on the table that is cancelled', async () => {
    const db = buildDb({
      booking: leftBooking,
      myAssignments: shortened,
      ...nextParty,
      otherBookings: [{ id: OTHER, booking_reference: 'TB-GONE', status: 'cancelled', left_at: null }],
    })
    signIn(db)

    expect((await callUndo(leftTicket)).status).toBe(200)
  })

  it('leaves the booking as left when the database refuses the table time', async () => {
    const db = buildDb({ booking: leftBooking, myAssignments: shortened, refuseAssignmentUpdate: true })
    signIn(db)

    const { status, body } = await callUndo(leftTicket)

    expect(status).toBe(409)
    expect(body.error).toContain('still marked as left')
    expect(db.writes.filter((write) => write.table === 'table_bookings')).toHaveLength(0)
  })

  it('puts the table times back when the booking changed under the undo', async () => {
    const db = buildDb({ booking: leftBooking, myAssignments: shortened, bookingUpdateMatches: false })
    signIn(db)

    const { status } = await callUndo(leftTicket)

    expect(status).toBe(409)
    const assignmentWrites = db.writes.filter((write) => write.table === 'booking_table_assignments')
    expect(assignmentWrites.map((write) => write.values.end_datetime)).toEqual([PLANNED_END, LEFT_AT])
  })

  it('does nothing when the booking was marked as left again since', async () => {
    const db = buildDb({ booking: { ...leftBooking, left_at: '2026-11-21T19:31:00.000Z' }, myAssignments: shortened })
    signIn(db)

    const { status } = await callUndo(leftTicket)

    expect(status).toBe(409)
    expect(db.writes).toHaveLength(0)
  })

  it('never restores an end that is not later than the one it has', async () => {
    const db = buildDb({ booking: leftBooking, myAssignments: shortened })
    signIn(db)

    const earlier = '2026-11-21T19:10:00.000Z'
    const { status } = await callUndo({
      action: 'left',
      stamp: LEFT_AT,
      restore: { end_datetime: earlier, assignments: [{ table_id: TABLE, end_datetime: earlier }] },
    })

    expect(status).toBe(200)
    expect(db.writes.filter((write) => write.table === 'booking_table_assignments')).toHaveLength(0)
    expect(db.writes.find((write) => write.table === 'table_bookings')?.values).not.toHaveProperty('end_datetime')
  })
})

describe('undoing Seated and No-show', () => {
  it('undoes a seating only while the booking still carries that seating', async () => {
    const db = buildDb({})
    signIn(db)

    const { status } = await callUndo({ action: 'seated', stamp: START })

    expect(status).toBe(200)
    expect(db.writes[0].values).toMatchObject({ seated_at: null })
    expect(db.writes[0].filters).toContainEqual(['eq', 'seated_at', START])
    expect(db.writes[0].filters).toContainEqual(['is', 'left_at', null])
  })

  it('puts a no-show back to confirmed after the table and deposit checks', async () => {
    const db = buildDb({ booking: { id: ID, status: 'no_show', no_show_at: LEFT_AT, event_booking_id: null } })
    signIn(db)
    mocks.canComeBack.mockResolvedValue(null)

    const { status } = await callUndo({ action: 'no_show', stamp: LEFT_AT })

    expect(status).toBe(200)
    expect(mocks.canComeBack).toHaveBeenCalledTimes(1)
    expect(db.writes[0].values).toMatchObject({ status: 'confirmed', no_show_at: null, no_show_marked_by: null })
    expect(db.writes[0].filters).toContainEqual(['eq', 'status', 'no_show'])
  })

  it('says why a no-show cannot come back, and leaves it', async () => {
    const db = buildDb({ booking: { id: ID, status: 'no_show', no_show_at: LEFT_AT, event_booking_id: null } })
    signIn(db)
    mocks.canComeBack.mockResolvedValue('Its table is now booked by TB-NEXT at that time, so this booking cannot be put back. Move one of them first.')

    const { status, body } = await callUndo({ action: 'no_show', stamp: LEFT_AT })

    expect(status).toBe(409)
    expect(body.error).toContain('TB-NEXT')
    expect(db.writes).toHaveLength(0)
  })

  it('refuses a ticket it does not understand', async () => {
    signIn(buildDb({}))
    expect((await callUndo({ action: 'cancelled' })).status).toBe(400)
  })
})
