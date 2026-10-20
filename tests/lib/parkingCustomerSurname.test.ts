import { describe, expect, it, vi } from 'vitest'

import { resolveCustomerByPhone } from '@/lib/parking/customers'

// customers.last_name is NOT NULL with no default. The resolver inserted null for a new
// customer with no surname, or one of only spaces, and the insert failed as a server error
// (19 October 2026). It now refuses before the insert; a customer on file needs no surname.

function fakeSupabase(onFile: Record<string, unknown> | null) {
  const insert = vi.fn()
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: async () => ({ data: onFile ? [onFile] : [], error: null }),
    insert,
  }
  return { insert, client: { from: vi.fn(() => query) } }
}

describe('parking customer resolution: surname', () => {
  it.each([
    ['only spaces', '   '],
    ['left out', undefined],
  ])('refuses to add a new customer whose surname is %s, before any insert', async (_label, lastName) => {
    const { insert, client } = fakeSupabase(null)

    await expect(
      resolveCustomerByPhone(client as any, { firstName: 'Pat', lastName, phone: '07700900123' })
    ).rejects.toThrow('Surname is required for a new customer')
    expect(insert).not.toHaveBeenCalled()
  })

  it('resolves a customer already on file when no surname is typed', async () => {
    const { insert, client } = fakeSupabase({
      id: 'customer-on-file',
      first_name: 'Pat',
      last_name: 'Example',
      mobile_number: '+447700900123',
      mobile_e164: '+447700900123',
      email: null,
    })

    const customer = await resolveCustomerByPhone(client as any, {
      firstName: 'Pat',
      lastName: '   ',
      phone: '07700900123',
    })

    expect(customer).toMatchObject({ id: 'customer-on-file', last_name: 'Example' })
    expect(insert).not.toHaveBeenCalled()
  })
})
