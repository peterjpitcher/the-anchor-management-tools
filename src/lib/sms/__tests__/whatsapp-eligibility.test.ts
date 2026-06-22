import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCustomerWhatsAppSendAllowed } from '@/lib/twilio'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function buildCustomerLookup(customer: Record<string, unknown>) {
  const chain: Record<string, any> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: customer, error: null })
  return chain
}

const baseCustomer = {
  whatsapp_status: 'active',
  whatsapp_opt_in: true,
  marketing_whatsapp_opt_in: true,
  mobile_e164: '+447700900001',
  mobile_number: '+447700900001',
}

describe('isCustomerWhatsAppSendAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TWILIO_WHATSAPP_APPROVED_TEMPLATE_KEYS', 'approved_template')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires an approved template outside the 24 hour service window', async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildCustomerLookup({
      ...baseCustomer,
      last_whatsapp_inbound_at: '2026-06-20T00:00:00.000Z',
    }) as any)

    await expect(isCustomerWhatsAppSendAllowed('customer-1', '+447700900001'))
      .resolves.toEqual({ allowed: false, reason: 'whatsapp_template_required' })

    await expect(isCustomerWhatsAppSendAllowed('customer-1', '+447700900001', {
      templateKey: 'not_approved',
    })).resolves.toEqual({ allowed: false, reason: 'whatsapp_template_not_approved' })
  })

  it('allows approved templates outside the 24 hour service window', async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildCustomerLookup({
      ...baseCustomer,
      last_whatsapp_inbound_at: '2026-06-20T00:00:00.000Z',
    }) as any)

    await expect(isCustomerWhatsAppSendAllowed('customer-1', '+447700900001', {
      templateKey: 'approved_template',
    })).resolves.toEqual({ allowed: true })
  })

  it('allows freeform messages inside the 24 hour service window', async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildCustomerLookup({
      ...baseCustomer,
      last_whatsapp_inbound_at: new Date().toISOString(),
    }) as any)

    await expect(isCustomerWhatsAppSendAllowed('customer-1', '+447700900001'))
      .resolves.toEqual({ allowed: true })
  })
})
