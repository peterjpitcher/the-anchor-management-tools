// src/tests/api/foh/deposit-waiver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth and Supabase before importing the route
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }
  })
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/bookings/route'

// The real PermissionCheckResult ok:true branch has no `response` field.
// We use `as unknown as` casts to avoid coupling the test to internal types.
type MockOkResult = {
  ok: true
  userId: string
  supabase: any // typed as any to avoid brittle coupling to the internal Supabase admin client type
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
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
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
    // NOTE: This test will continue to fail (returning 400 from Zod) until BOTH:
    // 1. waive_deposit is added to the schema (Task 4 Step 1), AND
    // 2. the role check block is added (Task 4 Step 3)
    // After both steps, it should return 403 for a staff user.
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
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ roles: { name: 'manager' } }]
              })
            })
          }
        }
        if (table === 'customers') {
          const eqChain = {
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: '00000000-0000-0000-0000-000000000001', mobile_e164: '+441234567890', mobile_number: '01234567890' },
              error: null
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
          eqChain.eq.mockReturnValue(eqChain)
          return { select: vi.fn().mockReturnValue(eqChain) }
        }
        // All other tables: return empty/success stubs
        const eqChain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
        // eq returns itself so further chaining works
        eqChain.eq.mockReturnValue(eqChain)
        return {
          select: vi.fn().mockReturnValue(eqChain),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null })
        }
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
    // Should succeed (201) — not blocked on deposit method missing
    expect(res.status).toBe(201)
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
