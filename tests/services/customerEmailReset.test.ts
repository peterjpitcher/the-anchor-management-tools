/**
 * A corrected address has to be emailable again.
 *
 * `email_deactivated_at` is what `isEmailUsable` reads. Nothing cleared it when the address
 * changed, so a bounce from a mistyped address kept the corrected one on texts for ever. Two
 * customers were in that state on 12 September 2026.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

function buildClient(currentEmail: string | null) {
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'customer-1' }, error: null }),
      }),
    }),
  })

  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { email: currentEmail }, error: null }),
    }),
  })

  createClient.mockResolvedValue({
    from: vi.fn(() => ({ update, select })),
  })

  return { update }
}

async function updateEmail(currentEmail: string | null, nextEmail: string) {
  const client = buildClient(currentEmail)
  const { CustomerService } = await import('@/services/customers')
  await CustomerService.updateCustomer('customer-1', { email: nextEmail } as any)
  return client.update.mock.calls[0][0] as Record<string, unknown>
}

describe('CustomerService.updateCustomer email state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('clears the deactivation when the address changes', async () => {
    const payload = await updateEmail('typo@example.com', 'guest@example.com')

    expect(payload).toMatchObject({
      email: 'guest@example.com',
      email_status: 'unknown',
      email_deactivated_at: null,
      email_delivery_failures: 0,
      last_email_failure_reason: null,
    })
  })

  it('clears it when an address is added for the first time', async () => {
    const payload = await updateEmail(null, 'guest@example.com')

    expect(payload.email_deactivated_at).toBeNull()
    expect(payload.email_status).toBe('unknown')
  })

  it('leaves a real bounce alone when the address is merely recased', async () => {
    const payload = await updateEmail('guest@example.com', 'Guest@Example.com')

    expect(payload).not.toHaveProperty('email_status')
    expect(payload).not.toHaveProperty('email_deactivated_at')
  })

  it('does not touch marketing consent, which belongs to the person', async () => {
    const payload = await updateEmail('typo@example.com', 'guest@example.com')

    expect(payload).not.toHaveProperty('marketing_email_opt_in')
    expect(payload).not.toHaveProperty('marketing_email_opted_out_at')
  })
})
