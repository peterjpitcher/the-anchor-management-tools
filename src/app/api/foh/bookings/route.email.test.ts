import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

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

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// Minimal chainable Supabase query-builder mock (mirrors route.test.ts).
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'gte', 'gt', 'lt']) {
    builder[method] = vi.fn(chain)
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

function createSupabaseMock() {
  const rpc = vi.fn().mockResolvedValue({
    data: { state: 'confirmed', table_booking_id: 'booking-1', booking_reference: 'TB-TEST' },
    error: null,
  })
  const from = vi.fn((table: string) =>
    makeBuilder(
      table === 'table_bookings'
        ? { data: null, error: null }
        : { data: null, error: null },
    ),
  )
  return { from, rpc }
}

function mockAuthSuccess(dbMock: Record<string, unknown>) {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Awaited<ReturnType<typeof requireFohPermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

const baseNewCustomerBody = {
  phone: '07700900000',
  first_name: 'Jane',
  last_name: 'Doe',
  date: '2026-08-01',
  time: '18:00',
  party_size: 2,
  purpose: 'food' as const,
}

describe('POST /api/foh/bookings — optional email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: CUSTOMER_ID })
  })

  it('threads a valid email into ensureCustomerForPhone for a new phone-only customer', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(makeRequest({ ...baseNewCustomerBody, email: 'Guest@Example.com' }))

    expect(res.status).toBe(201)
    expect(ensureCustomerForPhone).toHaveBeenCalledWith(
      expect.anything(),
      '+447700900000',
      expect.objectContaining({ email: 'Guest@Example.com' }),
    )
  })

  it('rejects an invalid email with a 400 and never resolves a customer', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(makeRequest({ ...baseNewCustomerBody, email: 'not-an-email' }))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(json.error.length).toBeGreaterThan(0)
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })

  it('treats an omitted email as valid (email undefined)', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await POST(makeRequest({ ...baseNewCustomerBody }))

    expect(res.status).toBe(201)
    expect(ensureCustomerForPhone).toHaveBeenCalledWith(
      expect.anything(),
      '+447700900000',
      expect.objectContaining({ email: undefined }),
    )
  })
})
