import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * AN EXPLICIT STOP IS NEVER OVERRIDABLE.
 *
 * `allowTransactionalOverride` used to return `{ allowed: true }` BEFORE the opt-in and
 * opt-out-status checks, so any caller passing it texted people who had replied STOP. The
 * Sunday lunch pre-order chase passes it, so an opted-out guest with a Sunday booking was
 * still messaged. Honouring STOP is a legal obligation under PECR, not a preference.
 *
 * The override still exists, because a genuinely transactional message should bypass the
 * softer `sms_status` gate. It just no longer outranks an explicit opt-out.
 */

let customerRow: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: customerRow, error: null }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const { isCustomerSmsSendAllowed } = await import('@/lib/twilio')

const TO = '+447700900123'

function customer(overrides: Record<string, unknown> = {}) {
  return {
    sms_status: 'active',
    sms_opt_in: true,
    mobile_e164: TO,
    mobile_number: '07700900123',
    ...overrides,
  }
}

beforeEach(() => {
  customerRow = customer()
})

describe('isCustomerSmsSendAllowed', () => {
  it('blocks an explicit opt-out even when a transactional override is requested', async () => {
    customerRow = customer({ sms_opt_in: false, sms_status: 'opted_out' })

    const result = await isCustomerSmsSendAllowed('cust-1', TO, {
      allowTransactionalOverride: true,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('sms_opt_in_blocked')
  })

  it('blocks an opted_out status even when opt_in was never set false', async () => {
    customerRow = customer({ sms_opt_in: null, sms_status: 'opted_out' })

    const result = await isCustomerSmsSendAllowed('cust-1', TO, {
      allowTransactionalOverride: true,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('sms_status_blocked')
  })

  it('still lets the override bypass the softer status gate', async () => {
    // This is what the override is for: a genuinely transactional message to someone who
    // has not opted out but whose status is not plain 'active'.
    customerRow = customer({ sms_opt_in: true, sms_status: 'bounced' })

    const result = await isCustomerSmsSendAllowed('cust-1', TO, {
      allowTransactionalOverride: true,
    })

    expect(result.allowed).toBe(true)
  })

  it('blocks the same softer status without the override', async () => {
    customerRow = customer({ sms_opt_in: true, sms_status: 'bounced' })

    const result = await isCustomerSmsSendAllowed('cust-1', TO)

    expect(result.allowed).toBe(false)
  })

  it('allows a normal active opted-in customer', async () => {
    const result = await isCustomerSmsSendAllowed('cust-1', TO)
    expect(result.allowed).toBe(true)
  })
})
