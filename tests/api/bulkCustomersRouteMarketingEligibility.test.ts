import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { POST } from '@/app/api/messages/bulk/customers/route'

describe('bulk customers route marketing eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
  })

  it('filters out customers without marketing opt-in or blocked sms_status', async () => {
    const range = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Alex',
          last_name: null,
          mobile_number: '+447700900111',
          sms_opt_in: true,
          marketing_sms_opt_in: true,
          sms_status: 'active',
          created_at: '2026-02-01T00:00:00.000Z',
          bookings: [{ count: 0 }],
          event_bookings: [],
          category_preferences: [],
        },
        {
          id: 'customer-2',
          first_name: 'Blake',
          last_name: null,
          mobile_number: '+447700900222',
          sms_opt_in: true,
          marketing_sms_opt_in: false,
          sms_status: 'active',
          created_at: '2026-02-01T00:00:00.000Z',
          bookings: [{ count: 0 }],
          event_bookings: [],
          category_preferences: [],
        },
        {
          id: 'customer-3',
          first_name: 'Casey',
          last_name: null,
          mobile_number: '+447700900333',
          sms_opt_in: true,
          marketing_sms_opt_in: true,
          sms_status: 'opted_out',
          created_at: '2026-02-01T00:00:00.000Z',
          bookings: [{ count: 0 }],
          event_bookings: [],
          category_preferences: [],
        },
      ],
      error: null,
      count: 3,
    })

    const builder = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      range,
    }

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return builder
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const request = new Request('http://localhost/api/messages/bulk/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        filters: {},
        page: 1,
        pageSize: 50,
      }),
    })

    const response = await POST(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(
      expect.objectContaining({
        customers: [expect.objectContaining({ id: 'customer-1' })],
        truncated: false,
        totalMatches: 1,
        approximateMatches: 1,
      }),
    )
  })
})

