import { describe, expect, beforeEach, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

type QueryError = { message: string } | null

const messagesQueryResult: { data: any[] | null; error: QueryError } = { data: [], error: null }
const customerStatsQueryResult: { data: any[] | null; error: QueryError } = { data: [], error: null }
const failureQueryResult: { data: any[] | null; error: QueryError } = { data: [], error: null }

const mockAdminClient = {
  from: vi.fn((table: string) => {
    if (table === 'messages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => Promise.resolve({ data: messagesQueryResult.data, error: messagesQueryResult.error })),
          })),
        })),
      }
    }

    if (table === 'customers') {
      return {
        select: vi.fn((columns: string) => {
          if (columns.includes('recent_messages')) {
            return {
              or: vi.fn(() => ({
                order: vi.fn(() => Promise.resolve({ data: failureQueryResult.data, error: failureQueryResult.error })),
              })),
            }
          }

          return Promise.resolve({
            data: customerStatsQueryResult.data,
            error: customerStatsQueryResult.error,
          })
        }),
      }
    }

    throw new Error(`Unexpected table request: ${table}`)
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
  createClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getDeliveryFailureReport, getSmsDeliveryStats } from '@/app/actions/customerSmsActions'
import { createAdminClient } from '@/lib/supabase/server'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('customerSmsActions permission gating', () => {
  beforeEach(() => {
    mockedPermission.mockReset()
    mockedCreateAdminClient.mockClear()
    mockAdminClient.from.mockClear()

    messagesQueryResult.data = []
    messagesQueryResult.error = null
    customerStatsQueryResult.data = []
    customerStatsQueryResult.error = null
    failureQueryResult.data = []
    failureQueryResult.error = null
  })

  it('returns an error when the viewer lacks SMS health or customer permissions (stats)', async () => {
    mockedPermission.mockResolvedValueOnce(false)
    mockedPermission.mockResolvedValueOnce(true)

    const result = await getSmsDeliveryStats()
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })

  it('aggregates SMS metrics when permissions are granted', async () => {
    mockedPermission.mockResolvedValue(true)

    const now = new Date().toISOString()
    messagesQueryResult.data = [
      { twilio_status: 'delivered', price: 0.25, created_at: now },
      { twilio_status: 'failed', price: 0.25, created_at: now },
      { twilio_status: 'delivered', price: 0.5, created_at: now },
    ]
    customerStatsQueryResult.data = [{ sms_opt_in: true }, { sms_opt_in: false }, { sms_opt_in: true }]

    const result = await getSmsDeliveryStats()

    expect(result).toEqual({
      messages: {
        total: 3,
        byStatus: {
          delivered: 2,
          failed: 1,
        },
        totalCost: '1.00',
        deliveryRate: '66.7',
      },
      customers: {
        active: 2,
        inactive: 1,
        total: 3,
      },
    })
  })

  it('bubbles Supabase errors from the message query', async () => {
    mockedPermission.mockResolvedValue(true)
    messagesQueryResult.data = null
    messagesQueryResult.error = { message: 'query failed' }

    const result = await getSmsDeliveryStats()
    expect(result).toEqual({ error: 'query failed' })
  })

  it('returns an error when the viewer lacks permissions (failure report)', async () => {
    mockedPermission.mockResolvedValueOnce(true)
    mockedPermission.mockResolvedValueOnce(false)

    const result = await getDeliveryFailureReport()
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })

  it('returns queued failure records when permitted', async () => {
    mockedPermission.mockResolvedValue(true)
    failureQueryResult.data = [
      { id: '1', customer_name: 'Jane Doe', sms_delivery_failures: 2 },
      { id: '2', customer_name: 'John Smith', sms_delivery_failures: 1 },
    ]

    const result = await getDeliveryFailureReport()
    expect(result).toEqual({ customers: failureQueryResult.data })
  })
})
