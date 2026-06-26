import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { CustomerService } from '@/services/customers'

const mockedCreateClient = createClient as unknown as Mock

describe('CustomerService creation contact defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates manual customers with service SMS and WhatsApp active by default', async () => {
    let insertedPayload: Record<string, unknown> | null = null

    const canonicalLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const canonicalOrder = vi.fn().mockReturnValue({ limit: canonicalLimit })
    const canonicalEq = vi.fn().mockReturnValue({ order: canonicalOrder })

    const legacyLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const legacyOrder = vi.fn().mockReturnValue({ limit: legacyLimit })
    const legacyIn = vi.fn().mockReturnValue({ order: legacyOrder })

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-1' },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn((payload: Record<string, unknown>) => {
      insertedPayload = payload
      return { select: insertSelect }
    })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn(() => ({
            eq: canonicalEq,
            in: legacyIn,
          })),
          insert,
        }
      }),
    })

    await CustomerService.createCustomer({
      first_name: 'Alex',
      last_name: 'Rivers',
      mobile_number: '07700900111',
      email: 'alex@example.com',
      sms_opt_in: true,
    })

    expect(insertedPayload).toEqual(
      expect.objectContaining({
        mobile_number: '+447700900111',
        mobile_e164: '+447700900111',
        email: 'alex@example.com',
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: false,
        whatsapp_opt_in: true,
        whatsapp_status: 'active',
        marketing_whatsapp_opt_in: false,
        marketing_email_opt_in: false,
      }),
    )
  })

  it('passes service contact defaults through customer bulk import RPC', async () => {
    let rpcPayload: Record<string, unknown>[] | null = null

    mockedCreateClient.mockResolvedValue({
      rpc: vi.fn((_name: string, args: { p_customers: Record<string, unknown>[] }) => {
        rpcPayload = args.p_customers
        return Promise.resolve({
          data: { created: [{ id: 'customer-1' }], skippedExisting: 0 },
          error: null,
        })
      }),
    })

    await CustomerService.importCustomers([
      {
        first_name: 'Jamie',
        last_name: 'Lee',
        mobile_number: '07700900222',
        email: 'jamie@example.com',
        sms_opt_in: true,
      },
    ])

    expect(rpcPayload).toEqual([
      expect.objectContaining({
        mobile_number: '+447700900222',
        mobile_e164: '+447700900222',
        email: 'jamie@example.com',
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: false,
        whatsapp_opt_in: true,
        whatsapp_status: 'active',
        marketing_whatsapp_opt_in: false,
        marketing_email_opt_in: false,
      }),
    ])
  })
})
