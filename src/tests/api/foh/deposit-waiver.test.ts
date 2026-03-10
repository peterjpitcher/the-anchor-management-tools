// src/tests/api/foh/deposit-waiver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth and Supabase before importing the route
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn()
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/bookings/route'

// The real PermissionCheckResult ok:true branch has no `response` field.
// We use `as unknown as` casts to avoid coupling the test to internal types.
type MockOkResult = {
  ok: true
  userId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
}

function makeRequest(body: object) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }) as unknown as import('next/server').NextRequest
}

const baseBookingPayload = {
  customer_id: '00000000-0000-0000-0000-000000000001',
  date: '2026-04-05',
  time: '13:00',
  party_size: 8,
  purpose: 'food'
}

describe('POST /api/foh/bookings — deposit waiver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when a non-manager tries to waive the deposit', async () => {
    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-1',
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ roles: { name: 'staff' } }]
            })
          })
        })
      }
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/permission/i)
  })

  it('should allow a manager to waive the deposit', async () => {
    const mockRpcResult = {
      data: {
        state: 'confirmed',
        table_booking_id: 'booking-1',
        booking_reference: 'REF001',
        reason: null,
        table_name: 'Table 1'
      },
      error: null
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ roles: { name: 'manager' } }]
          })
        })
      }),
      rpc: vi.fn().mockResolvedValue(mockRpcResult)
    }

    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-2',
      supabase: mockSupabase
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    // Should succeed (200) — not blocked on deposit method missing
    expect(res.status).toBe(200)
  })

  it('should require sunday_deposit_method when waive_deposit is false and party_size >= 7', async () => {
    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-3',
      supabase: {}
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: false })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/deposit/i)
  })
})
