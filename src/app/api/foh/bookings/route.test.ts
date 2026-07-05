import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireFohPermission } from '@/lib/foh/api-auth'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
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

const makeRequest = (body: unknown) =>
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

  const from = vi.fn((table: string) => makeBuilder(fromResults[table] ?? { data: null, error: null }))

  return { from, rpc }
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
      'create_table_booking_v05',
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
      'create_table_booking_v05',
      expect.objectContaining({ p_bypass_pacing: false }),
    )
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
      'create_table_booking_v05',
      expect.objectContaining({ p_bypass_pacing: true }),
    )
  })
})
