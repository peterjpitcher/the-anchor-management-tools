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

// Walk-in launch (spec §6, §7.3): the deposit threshold is now 10+ (not 7+).
// Party_size: 10 puts the booking on the deposit-required side of the boundary.
const baseBookingPayload = {
  customer_id: '00000000-0000-0000-0000-000000000001',
  date: '2026-04-05',
  time: '13:00',
  party_size: 10,
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

  // Defects AB-001 / WF-004: management_override = waiver. A super_admin
  // creating a 10+ override booking with NO sunday_deposit_method must NOT
  // be rejected by the deposit gate. The schema (line ~96) already exempts
  // override; the runtime requiresDeposit calculation (line ~1063) now
  // honours it too. We assert the schema-pass branch by allowing the
  // request to reach the super_admin role check rather than returning 400
  // from the deposit gate.
  it('management_override with party_size>=10 and no deposit method is not blocked by the deposit gate', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'user_roles') {
          // Non-super_admin: the override path will return 403 from the
          // role check. Crucially this proves we got past Zod validation
          // and past the deposit gate — they would each return 400, not 403.
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ roles: { name: 'manager' } }]
              })
            })
          }
        }
        const eqChain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
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
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    }

    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-mgmt',
      supabase: mockSupabase
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({
      customer_id: '00000000-0000-0000-0000-000000000001',
      date: '2026-04-05',
      time: '13:00',
      party_size: 12,
      purpose: 'food',
      management_override: true
      // Critically: no sunday_deposit_method — would fail the deposit gate
      // for a non-override booking with party_size=12.
    })
    const res = await POST(req)
    // 403 = override role-check rejected non-super_admin user.
    // We expect 403, NOT 400 (which is what the deposit gate or Zod would
    // return). Either 400 outcome would indicate the override exemption
    // had regressed.
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/super_admin/i)
  })

  it('requires a deposit decision when party_size >= 10 and waive_deposit is false', async () => {
    // Use the same comprehensive mock as the manager-waive case so the route's
    // customer-lookup step succeeds and we exercise the actual deposit gate.
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
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
          eqChain.eq.mockReturnValue(eqChain)
          return { select: vi.fn().mockReturnValue(eqChain) }
        }
        const eqChain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
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
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    }

    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-3',
      supabase: mockSupabase
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: false })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/deposit/i)
  })
})
