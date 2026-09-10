import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { recordOneCourseInsideCutoff } from '@/lib/table-bookings/christmas-one-course'
import {
  FOH_BOOKING_CLIENT_CONTRACT,
  FOH_BOOKING_CLIENT_HEADER,
  FOH_CLIENT_OUTDATED_CODE,
} from '@/lib/foh/booking-client-contract'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-08-01'),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/sms/customers', () => ({
  // Literal must be inline: vi.mock factories are hoisted above const declarations.
  ensureCustomerForPhone: vi.fn().mockResolvedValue({ customerId: '11111111-1111-4111-8111-111111111111' }),
}))
vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn(() => '+447700900000'),
}))
vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/table-bookings/move-table', () => ({
  isAssignmentConflictError: vi.fn(() => false),
}))
vi.mock('@/lib/table-bookings/deposit', () => ({
  // party_size 2 never requires a deposit in these tests.
  requiresDeposit: vi.fn(() => false),
  computeDepositAmount: vi.fn(() => 0),
  // The route now reaches the seasonal resolver, which reads the live party-size rule from this
  // module. Leaving these out made the whole suite fail to import.
  LARGE_GROUP_DEPOSIT_THRESHOLD: 10,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP: 10,
}))
// No seasonal period covers the dates these tests use, so the route falls through to the
// party-size rule exactly as it did before seasonal periods existed.
vi.mock('@/lib/table-bookings/period-lookup', () => ({
  loadBookingPeriodContext: vi.fn().mockResolvedValue({ period: null, collectPeriodDeposits: true }),
  expectedDepositForCreate: vi.fn(() => null),
}))
vi.mock('@/lib/table-bookings/christmas-one-course', () => ({
  recordOneCourseInsideCutoff: vi.fn().mockResolvedValue('not_needed'),
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  mapTableBookingBlockedReason: vi.fn((reason: string | null) => reason ?? 'blocked'),
  createTablePaymentToken: vi.fn().mockResolvedValue('tok_test'),
  alignTablePaymentHoldToScheduledSend: vi.fn().mockResolvedValue(null),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ ok: true }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ ok: true, scheduledFor: null }),
}))

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const NEW_WALKIN_ID = '22222222-2222-4222-8222-222222222222'

const makeRequest = (body: Record<string, unknown>) => {
  const customerMode = body.customer_mode ?? (
    body.customer_id ? 'selected' : body.phone ? 'phone' : 'anonymous'
  )
  return new NextRequest('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT,
    },
    body: JSON.stringify({ customer_mode: customerMode, ...body }),
  })
}

const makeOutdatedRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// Build a chainable Supabase query-builder mock. Terminal awaits (thenable) and
// .maybeSingle()/.single() resolve to `result`. Each from(table) returns a fresh
// builder whose result is supplied per table by the caller.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    'select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'gte', 'gt', 'lt',
  ]) {
    builder[method] = vi.fn(chain)
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.single = vi.fn().mockResolvedValue(result)
  // Awaiting the builder directly (e.g. user_roles .select().eq()) resolves to result.
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

type FromResults = Record<string, { data: unknown; error: unknown }>

function createSupabaseMock(options: {
  fromResults?: FromResults
  roleRows?: Array<{ roles: { name: string } | null }> | null
  rpcResult?: { data: unknown; error: unknown }
} = {}) {
  const rpc = vi.fn().mockResolvedValue(
    options.rpcResult ?? {
      data: { state: 'confirmed', table_booking_id: 'booking-1', booking_reference: 'TB-TEST' },
      error: null,
    },
  )

  const defaults: FromResults = {
    customers: { data: { id: CUSTOMER_ID, mobile_e164: '+447700900000', mobile_number: '+447700900000' }, error: null },
    table_bookings: { data: null, error: null },
    user_roles: { data: options.roleRows ?? null, error: null },
  }
  const fromResults = { ...defaults, ...(options.fromResults ?? {}) }
  const builders: Record<string, Array<ReturnType<typeof makeBuilder>>> = {}

  const from = vi.fn((table: string) => {
    const builder = makeBuilder(fromResults[table] ?? { data: null, error: null })
    builders[table] = [...(builders[table] || []), builder]
    return builder
  })

  return { from, rpc, builders }
}

function mockAuthSuccess(dbMock: Record<string, unknown>) {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Awaited<ReturnType<typeof requireFohPermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

describe('POST /api/foh/bookings — kitchen pacing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an outdated FOH screen before it can create an anonymous booking', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeOutdatedRequest({
        walk_in: true,
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      code: FOH_CLIENT_OUTDATED_CODE,
      refresh_required: true,
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('keeps a selected customer on a walk-in booking', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        walk_in: true,
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith(
      'create_table_booking_staff_v06',
      expect.objectContaining({ p_customer_id: CUSTOMER_ID }),
    )
  })

  it('rejects a future table walk-in and tells staff to create a booking', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        walk_in: true,
        date: '2026-08-02',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/use add booking/i),
    })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(db.builders.table_bookings).toBeUndefined()
  })

  it('passes p_bypass_pacing: true to the RPC for a walk-in', async () => {
    const db = createSupabaseMock({
      fromResults: {
        // createWalkInCustomer inserts and reads back an id.
        customers: { data: { id: NEW_WALKIN_ID }, error: null },
      },
    })
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        walk_in: true,
        walk_in_guest_name: 'Jane Doe',
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith(
      'create_table_booking_staff_v06',
      expect.objectContaining({ p_bypass_pacing: true }),
    )
  })

  it('passes p_bypass_pacing: false for a normal FOH booking without override', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith(
      'create_table_booking_staff_v06',
      expect.objectContaining({ p_bypass_pacing: false }),
    )
  })

  it('bypasses kitchen pacing for a drinks booking', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        date: '2026-08-01',
        time: '18:00',
        party_size: 4,
        purpose: 'drinks',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith(
      'create_table_booking_staff_v06',
      expect.objectContaining({ p_bypass_pacing: true }),
    )
  })

  it('creates a new customer booking without a last name', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        phone: '07700900000',
        first_name: 'Sam',
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledTimes(1)
  })

  it('returns 403 when a non-manager sets bypass_pacing and never calls the RPC', async () => {
    const db = createSupabaseMock({ roleRows: [{ roles: { name: 'staff' } }] })
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        bypass_pacing: true,
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/override kitchen pacing/i)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('allows a manager to override pacing and passes p_bypass_pacing: true', async () => {
    const db = createSupabaseMock({ roleRows: [{ roles: { name: 'manager' } }] })
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        bypass_pacing: true,
        date: '2026-08-01',
        time: '18:00',
        party_size: 2,
        purpose: 'food',
      }),
    )

    expect(res.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith(
      'create_table_booking_staff_v06',
      expect.objectContaining({ p_bypass_pacing: true }),
    )
  })
})

// The refusal table_bookings_service_window_guard raised for every walk-in on 9 September 2026.
const KITCHEN_NOT_SERVING = {
  code: '22023',
  message: 'The kitchen is not serving at 20:34 on 01 Aug 2026. Please choose a time inside a food service.',
  details: null,
  hint: null,
}

// A walk-in with no name or number, as the floor adds them during service.
const ANONYMOUS_WALK_IN = {
  walk_in: true,
  walk_in_guest_name: 'Walk in',
  date: '2026-08-01',
  time: '20:34',
  party_size: 2,
  purpose: 'food',
}

type Builder = ReturnType<typeof makeBuilder>

// The builders that deleted from customers. The walk-in insert is a separate builder.
function customerDeletes(db: ReturnType<typeof createSupabaseMock>): Builder[] {
  return (db.builders.customers ?? []).filter(
    (builder) => vi.mocked(builder.delete as ReturnType<typeof vi.fn>).mock.calls.length > 0,
  )
}

// The dummy number createWalkInCustomer generated for this request.
function insertedWalkInPhone(db: ReturnType<typeof createSupabaseMock>): string {
  const insert = db.builders.customers[0].insert as ReturnType<typeof vi.fn>
  return (insert.mock.calls[0][0] as { mobile_e164: string }).mobile_e164
}

describe('POST /api/foh/bookings: failed walk-ins and kitchen-hours refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the made-up walk-in customer when the booking fails', async () => {
    const db = createSupabaseMock({
      fromResults: { customers: { data: { id: NEW_WALKIN_ID }, error: null } },
      rpcResult: { data: null, error: { code: 'XX000', message: 'connection reset', details: null, hint: null } },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(500)
    const deletes = customerDeletes(db)
    expect(deletes).toHaveLength(1)
    expect(deletes[0].eq).toHaveBeenCalledWith('id', NEW_WALKIN_ID)
    expect(deletes[0].eq).toHaveBeenCalledWith('mobile_e164', insertedWalkInPhone(db))
  })

  it('removes it when the booking comes back blocked, because no booking row exists', async () => {
    const db = createSupabaseMock({
      fromResults: { customers: { data: { id: NEW_WALKIN_ID }, error: null } },
      rpcResult: { data: { state: 'blocked', reason: 'no_table' }, error: null },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ data: { state: 'blocked', reason: 'no_table' } })
    expect(customerDeletes(db)).toHaveLength(1)
  })

  it('keeps the walk-in customer once a booking exists', async () => {
    const db = createSupabaseMock({
      fromResults: { customers: { data: { id: NEW_WALKIN_ID }, error: null } },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(201)
    expect(customerDeletes(db)).toHaveLength(0)
  })

  it('never removes a customer the request did not create', async () => {
    const db = createSupabaseMock({
      rpcResult: { data: null, error: { code: 'XX000', message: 'connection reset', details: null, hint: null } },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest({ ...ANONYMOUS_WALK_IN, customer_id: CUSTOMER_ID }))

    expect(res.status).toBe(500)
    expect(customerDeletes(db)).toHaveLength(0)
  })

  it('keeps the walk-in customer if a booking turns out to refer to it after all', async () => {
    const db = createSupabaseMock({
      fromResults: {
        customers: { data: { id: NEW_WALKIN_ID }, error: null },
        table_bookings: { data: [{ id: 'tb-cancelled' }], error: null },
      },
      rpcResult: { data: { state: 'blocked', reason: 'no_table' }, error: null },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(200)
    expect(customerDeletes(db)).toHaveLength(0)
  })

  it('still gives staff the original answer when the tidy-up cannot run', async () => {
    const db = createSupabaseMock({
      fromResults: {
        customers: { data: { id: NEW_WALKIN_ID }, error: null },
        bookings: { data: null, error: { code: '57014', message: 'statement timeout', details: null, hint: null } },
      },
      rpcResult: { data: { state: 'blocked', reason: 'no_table' }, error: null },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ data: { state: 'blocked', reason: 'no_table' } })
    expect(customerDeletes(db)).toHaveLength(0)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/could not check/i),
      expect.objectContaining({ metadata: expect.objectContaining({ customerId: NEW_WALKIN_ID }) }),
    )
  })

  it('tells staff the kitchen is not serving, instead of a generic failure', async () => {
    const db = createSupabaseMock({ rpcResult: { data: null, error: KITCHEN_NOT_SERVING } })
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({ customer_id: CUSTOMER_ID, date: '2026-08-01', time: '20:34', party_size: 2, purpose: 'food' }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: KITCHEN_NOT_SERVING.message })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('gives a refused walk-in the same message, and removes its made-up customer', async () => {
    const db = createSupabaseMock({
      fromResults: { customers: { data: { id: NEW_WALKIN_ID }, error: null } },
      rpcResult: { data: null, error: KITCHEN_NOT_SERVING },
    })
    mockAuthSuccess(db)

    const res = await POST(makeRequest(ANONYMOUS_WALK_IN))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: KITCHEN_NOT_SERVING.message })
    expect(customerDeletes(db)).toHaveLength(1)
  })
})

describe('POST /api/foh/bookings: Christmas booked inside the pre-order deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks for the booking to be recorded as one course, since this screen takes no courses', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({
        customer_id: CUSTOMER_ID,
        date: '2026-12-01',
        time: '18:00',
        party_size: 8,
        purpose: 'christmas',
        sunday_deposit_method: 'cash',
      }),
    )

    expect(res.status).toBe(201)
    // The helper decides from the database's own deadline whether anything changes.
    expect(recordOneCourseInsideCutoff).toHaveBeenCalledWith(db, {
      id: 'booking-1',
      bookingDate: '2026-12-01',
      partySize: 8,
    })
  })

  it('leaves every other booking alone', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(
      makeRequest({ customer_id: CUSTOMER_ID, date: '2026-08-01', time: '18:00', party_size: 2, purpose: 'food' }),
    )

    expect(res.status).toBe(201)
    expect(recordOneCourseInsideCutoff).not.toHaveBeenCalled()
  })
})
