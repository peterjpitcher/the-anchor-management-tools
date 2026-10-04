import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { VendorService } from '@/services/vendors'

const mockedCreateClient = createClient as unknown as ReturnType<typeof vi.fn>

function makeSupabase() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'vendor-1', name: 'Client Ltd' }, error: null })
  const select = vi.fn(() => ({ maybeSingle }))
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { client: { from }, update }
}

const formFields = {
  name: 'Client Ltd',
  phone: '',
  address: '',
  vat_number: '',
  payment_terms: 7,
  notes: '',
  paypal_payments_enabled: true,
}

describe('VendorService.updateVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The Vendors page form has no email or contact name field. Saving it (for example to switch
  // on online payment) used to write null over both, which wiped seven client records in
  // production and left four private hire customers with no address for a payment chase.
  it('leaves email and contact name alone when the caller did not supply them', async () => {
    const { client, update } = makeSupabase()
    mockedCreateClient.mockResolvedValue(client)

    await VendorService.updateVendor('vendor-1', formFields)

    const payload = update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('email')
    expect(payload).not.toHaveProperty('contact_name')
    expect(payload).toMatchObject({ name: 'Client Ltd', paypal_payments_enabled: true, payment_terms: 7 })
  })

  it('writes email and contact name when the caller supplied them', async () => {
    const { client, update } = makeSupabase()
    mockedCreateClient.mockResolvedValue(client)

    await VendorService.updateVendor('vendor-1', {
      ...formFields,
      email: 'accounts@example.com',
      contact_name: 'Sam Example',
    })

    expect(update.mock.calls[0][0]).toMatchObject({
      email: 'accounts@example.com',
      contact_name: 'Sam Example',
    })
  })

  it('treats a supplied empty string as a deliberate clear', async () => {
    const { client, update } = makeSupabase()
    mockedCreateClient.mockResolvedValue(client)

    await VendorService.updateVendor('vendor-1', { ...formFields, email: '', contact_name: '' })

    expect(update.mock.calls[0][0]).toMatchObject({ email: null, contact_name: null })
  })
})
