import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Walk-in customer creation, previously duplicated across both FOH booking routes and
 * covered by nothing.
 *
 * The behaviour worth pinning is the retry. A walk-in gets a synthetic phone number
 * picked at random, and an optional email. Either can collide with an existing row, so
 * the function retries. The two collisions must be handled differently: a phone clash
 * should be retried with a new number, while an email clash should drop the email and
 * keep going, because the email is enrichment and must never stop bar staff seating
 * someone.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { splitWalkInGuestName, createWalkInCustomer } from '@/lib/foh/walk-in-customer'

type InsertResult = { data: { id: string } | null; error: { code?: string; message?: string } | null }

/** @param results one result per insert attempt, in order */
function supabaseReturning(results: InsertResult[]) {
  const inserts: any[] = []
  let call = 0
  const client: any = {
    from: vi.fn(() => ({
      insert: vi.fn((payload: any) => {
        inserts.push(payload)
        const result = results[Math.min(call, results.length - 1)]
        call += 1
        return {
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(result),
        }
      }),
    })),
  }
  return { client, inserts }
}

const OK: InsertResult = { data: { id: 'cust-1' }, error: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('splitWalkInGuestName', () => {
  it.each([
    [undefined, {}],
    [null, {}],
    ['', {}],
    ['   ', {}],
  ])('returns nothing for %p', (input, expected) => {
    expect(splitWalkInGuestName(input as string | null | undefined)).toEqual(expected)
  })

  it('treats a single word as a first name only', () => {
    expect(splitWalkInGuestName('Dana')).toEqual({ firstName: 'Dana' })
  })

  it('splits a first and last name', () => {
    expect(splitWalkInGuestName('Dana Fox')).toEqual({ firstName: 'Dana', lastName: 'Fox' })
  })

  it('keeps everything after the first word as the surname', () => {
    // Guessing at middle names would put the wrong thing on the booking.
    expect(splitWalkInGuestName('Dana Maria Fox')).toEqual({ firstName: 'Dana', lastName: 'Maria Fox' })
  })

  it('copes with the stray whitespace of a name typed across the bar', () => {
    expect(splitWalkInGuestName('  Dana   Fox  ')).toEqual({ firstName: 'Dana', lastName: 'Fox' })
  })
})

describe('createWalkInCustomer', () => {
  it('creates a customer and returns the synthetic phone it reserved', async () => {
    const { client, inserts } = supabaseReturning([OK])

    const result = await createWalkInCustomer(client, { guestName: 'Dana Fox' })

    expect(result.customerId).toBe('cust-1')
    expect(result.syntheticPhone).toMatch(/^\+447000\d{6}$/)
    expect(inserts[0]).toMatchObject({ first_name: 'Dana', last_name: 'Fox' })
  })

  it('never opts a walk-in into SMS', async () => {
    const { client, inserts } = supabaseReturning([OK])

    await createWalkInCustomer(client, { guestName: 'Dana Fox' })

    // The number is invented, so texting it would go nowhere and could bill for it.
    expect(inserts[0]).toMatchObject({ sms_opt_in: false, sms_status: 'sms_deactivated' })
  })

  it('falls back to Walk-in when no name is given at all', async () => {
    const { client, inserts } = supabaseReturning([OK])

    await createWalkInCustomer(client, {})

    expect(inserts[0]).toMatchObject({ first_name: 'Walk-in', last_name: '' })
  })

  it('prefers explicit first and last names over the parsed guest name', async () => {
    const { client, inserts } = supabaseReturning([OK])

    await createWalkInCustomer(client, { firstName: 'Sam', lastName: 'Jones', guestName: 'Dana Fox' })

    expect(inserts[0]).toMatchObject({ first_name: 'Sam', last_name: 'Jones' })
  })

  it('normalises the email to lower case', async () => {
    const { client, inserts } = supabaseReturning([OK])

    await createWalkInCustomer(client, { guestName: 'Dana', email: '  Dana@Example.COM ' })

    expect(inserts[0]).toMatchObject({ email: 'dana@example.com' })
  })

  it('omits the email entirely when blank rather than writing an empty string', async () => {
    const { client, inserts } = supabaseReturning([OK])

    await createWalkInCustomer(client, { guestName: 'Dana', email: '   ' })

    expect(inserts[0]).not.toHaveProperty('email')
  })

  it('retries with a fresh phone number after a collision', async () => {
    const { client, inserts } = supabaseReturning([
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "customers_mobile_e164_key"' } },
      OK,
    ])

    const result = await createWalkInCustomer(client, { guestName: 'Dana' })

    expect(result.customerId).toBe('cust-1')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].mobile_e164).not.toBe(inserts[1].mobile_e164)
  })

  it('drops the email and keeps going when the email is what collided', async () => {
    const { client, inserts } = supabaseReturning([
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "customers_email_lower_idx"' } },
      OK,
    ])

    const result = await createWalkInCustomer(client, { guestName: 'Dana', email: 'dana@example.com' })

    // Seating the guest matters more than recording their email.
    expect(result.customerId).toBe('cust-1')
    expect(inserts[0]).toHaveProperty('email', 'dana@example.com')
    expect(inserts[1]).not.toHaveProperty('email')
  })

  it('gives up rather than looping forever on repeated collisions', async () => {
    const { client, inserts } = supabaseReturning([
      { data: null, error: { code: '23505', message: 'mobile clash' } },
    ])

    await expect(createWalkInCustomer(client, { guestName: 'Dana' })).rejects.toThrow(
      /reserve a walk-in customer profile/i
    )
    expect(inserts).toHaveLength(5)
  })

  it('fails fast on an error that retrying cannot fix', async () => {
    const { client, inserts } = supabaseReturning([
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ])

    await expect(createWalkInCustomer(client, { guestName: 'Dana' })).rejects.toThrow(
      /Failed to create walk-in customer/i
    )
    expect(inserts).toHaveLength(1)
  })
})
