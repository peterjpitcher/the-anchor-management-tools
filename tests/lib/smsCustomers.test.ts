import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'

type CustomerRow = {
  id: string
  mobile_e164: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type CustomerIdLookupRow = {
  id: string
  mobile_e164: string | null
  mobile_number: string | null
}

type MockSupabaseOptions = {
  canonicalMatch?: CustomerRow | null
  legacyMatch?: CustomerRow | null
  canonicalLookupError?: { message: string } | null
  legacyLookupError?: { message: string } | null
  idLookupRow?: CustomerIdLookupRow | null
  idLookupError?: { message: string } | null
  insertResult?: { data: { id: string } | null; error: { code?: string; message: string } | null }
  updateResult?: { data: { id: string } | null; error: { message: string } | null }
}

function createSupabaseMock(options: MockSupabaseOptions = {}) {
  const updates: Array<{ id: string; payload: Record<string, string> }> = []
  const inserts: Record<string, unknown>[] = []

  const canonicalMatch = options.canonicalMatch ?? null
  const legacyMatch = options.legacyMatch ?? null
  const canonicalLookupError = options.canonicalLookupError ?? null
  const legacyLookupError = options.legacyLookupError ?? null
  const idLookupRow = options.idLookupRow ?? null
  const idLookupError = options.idLookupError ?? null
  const insertResult = options.insertResult ?? {
    data: { id: 'new-customer' },
    error: null
  }
  const updateResult = options.updateResult ?? {
    data: { id: 'updated-customer' },
    error: null
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'customers') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string) => {
            if (column !== 'mobile_e164') {
              if (column === 'id') {
                return {
                  maybeSingle: vi.fn(async () => ({
                    data: idLookupError ? null : idLookupRow,
                    error: idLookupError
                  }))
                }
              }

              throw new Error(`Unexpected eq column: ${column}`)
            }

            return {
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: canonicalLookupError ? null : (canonicalMatch ? [canonicalMatch] : []),
                  error: canonicalLookupError
                }))
              }))
            }
          }),
          in: vi.fn((column: string) => {
            if (column !== 'mobile_number') {
              throw new Error(`Unexpected in column: ${column}`)
            }

            return {
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: legacyLookupError ? null : (legacyMatch ? [legacyMatch] : []),
                  error: legacyLookupError
                }))
              }))
            }
          })
        })),
        update: vi.fn((payload: Record<string, string>) => ({
          eq: vi.fn((column: string, id: string) => {
            if (column !== 'id') {
              throw new Error(`Unexpected update eq column: ${column}`)
            }

            updates.push({ id, payload })
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => updateResult)
              }))
            }
          })
        })),
        insert: vi.fn((payload: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              inserts.push(payload)
              return insertResult
            })
          }))
        }))
      }
    })
  }

  return {
    client: client as any,
    updates,
    inserts
  }
}

function createResolveCustomerIdSupabaseMock(options: {
  bookingRow?: Record<string, unknown> | null
  bookingError?: { message: string } | null
}) {
  const bookingRow = options.bookingRow ?? null
  const bookingError = options.bookingError ?? null

  return {
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string) => {
              if (column !== 'id') {
                throw new Error(`Unexpected private_bookings eq column: ${column}`)
              }
              return {
                maybeSingle: vi.fn(async () => ({
                  data: bookingRow,
                  error: bookingError
                }))
              }
            })
          }))
        }
      }

      if (table === 'customers') {
        throw new Error('Unexpected customers lookup while resolving booking context')
      }

      throw new Error(`Unexpected table: ${table}`)
    })
  } as any
}

describe('ensureCustomerForPhone', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('enriches existing placeholder names when real fallback names are provided', async () => {
    const { client, updates, inserts } = createSupabaseMock({
      canonicalMatch: {
        id: 'customer-1',
        mobile_e164: '+447700900123',
        first_name: 'Unknown',
        last_name: '0123',
        email: null
      }
    })

    const result = await ensureCustomerForPhone(client, '07700900123', {
      firstName: 'Jane',
      lastName: 'Smith'
    })

    expect(result.customerId).toBe('customer-1')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      id: 'customer-1',
      payload: {
        first_name: 'Jane',
        last_name: 'Smith'
      }
    })
    expect(inserts).toHaveLength(0)
  })

  it('does not overwrite existing non-placeholder names', async () => {
    const { client, updates } = createSupabaseMock({
      canonicalMatch: {
        id: 'customer-2',
        mobile_e164: '+447700900124',
        first_name: 'Existing',
        last_name: 'Name',
        email: null
      }
    })

    const result = await ensureCustomerForPhone(client, '07700900124', {
      firstName: 'New',
      lastName: 'Person'
    })

    expect(result.customerId).toBe('customer-2')
    expect(updates).toHaveLength(0)
  })

  it('warns when customer enrichment update affects no rows', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { client } = createSupabaseMock({
      canonicalMatch: {
        id: 'customer-3',
        mobile_e164: '+447700900555',
        first_name: 'Unknown',
        last_name: 'Guest',
        email: null
      },
      updateResult: {
        data: null,
        error: null
      }
    })

    await ensureCustomerForPhone(client, '07700900555', {
      firstName: 'Jamie',
      lastName: 'Rivers'
    })

    expect(warnSpy).toHaveBeenCalledWith(
      'Customer enrichment update affected no rows',
      expect.any(Object)
    )
    warnSpy.mockRestore()
  })

  it('splits a full name passed in firstName when lastName is missing', async () => {
    const { client, inserts } = createSupabaseMock()

    const result = await ensureCustomerForPhone(client, '07700900125', {
      firstName: 'Jane Smith'
    })

    expect(result.customerId).toBe('new-customer')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      first_name: 'Jane',
      last_name: 'Smith'
    })
  })

  it("uses a non-numeric placeholder last name when lastName is missing", async () => {
    const { client, inserts } = createSupabaseMock()

    await ensureCustomerForPhone(client, '07700900180', {
      firstName: 'Jane'
    })

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      first_name: 'Jane',
      last_name: 'Guest'
    })
  })

  it('fails closed and does not insert when customer lookup queries error', async () => {
    const { client, inserts } = createSupabaseMock({
      canonicalLookupError: { message: 'customers table read failure' }
    })

    const result = await ensureCustomerForPhone(client, '07700900126', {
      firstName: 'Alex'
    })

    expect(result).toEqual({
      customerId: null,
      standardizedPhone: '+447700900126',
      resolutionError: 'lookup_failed'
    })
    expect(inserts).toHaveLength(0)
  })
})

describe('resolveCustomerIdForSms', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when provided customerId lookup errors', async () => {
    const { client, inserts } = createSupabaseMock({
      idLookupError: { message: 'customers table read failure' }
    })

    const result = await resolveCustomerIdForSms(client, {
      customerId: 'customer-lookup-1',
      to: '07700900129'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'customer_lookup_failed'
    })
    expect(inserts).toHaveLength(0)
  })

  it('fails closed when provided customerId does not match the destination phone', async () => {
    const { client, inserts } = createSupabaseMock({
      idLookupRow: {
        id: 'customer-lookup-1',
        mobile_e164: '+447700900111',
        mobile_number: '+447700900111'
      }
    })

    const result = await resolveCustomerIdForSms(client, {
      customerId: 'customer-lookup-1',
      to: '07700900129'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'customer_phone_mismatch'
    })
    expect(inserts).toHaveLength(0)
  })

  it('returns the provided customerId when it matches the destination phone', async () => {
    const { client, inserts } = createSupabaseMock({
      idLookupRow: {
        id: 'customer-lookup-1',
        mobile_e164: '+447700900129',
        mobile_number: '+447700900129'
      }
    })

    const result = await resolveCustomerIdForSms(client, {
      customerId: 'customer-lookup-1',
      to: '07700900129'
    })

    expect(result).toEqual({
      customerId: 'customer-lookup-1'
    })
    expect(inserts).toHaveLength(0)
  })

  it('fails closed when direct customer lookup errors (no booking context)', async () => {
    const { client, inserts } = createSupabaseMock({
      canonicalLookupError: { message: 'customers table read failure' }
    })

    const result = await resolveCustomerIdForSms(client, {
      to: '07700900127'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'customer_lookup_failed'
    })
    expect(inserts).toHaveLength(0)
  })

  it('fails closed and does not insert when no matching customer exists (no booking context)', async () => {
    const { client, inserts } = createSupabaseMock()

    const result = await resolveCustomerIdForSms(client, {
      to: '07700900128'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'customer_not_found'
    })
    expect(inserts).toHaveLength(0)
  })

  it('returns existing customer id by phone without inserting (no booking context)', async () => {
    const { client, inserts } = createSupabaseMock({
      canonicalMatch: {
        id: 'customer-lookup-1',
        mobile_e164: '+447700900129',
        first_name: 'Existing',
        last_name: 'Customer',
        email: null
      }
    })

    const result = await resolveCustomerIdForSms(client, {
      to: '07700900129'
    })

    expect(result).toEqual({
      customerId: 'customer-lookup-1'
    })
    expect(inserts).toHaveLength(0)
  })

  it('fails closed when private booking lookup errors', async () => {
    const supabase = createResolveCustomerIdSupabaseMock({
      bookingError: { message: 'private booking lookup failed' }
    })

    const result = await resolveCustomerIdForSms(supabase, {
      bookingId: 'booking-1',
      to: '+447700900300'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'booking_lookup_failed'
    })
  })

  it('fails closed when private booking context row is missing', async () => {
    const supabase = createResolveCustomerIdSupabaseMock({
      bookingRow: null,
      bookingError: null
    })

    const result = await resolveCustomerIdForSms(supabase, {
      bookingId: 'booking-2',
      to: '+447700900301'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'booking_not_found'
    })
  })

  it('fails closed when private booking contact phone does not match destination phone', async () => {
    const supabase = createResolveCustomerIdSupabaseMock({
      bookingRow: {
        id: 'booking-3',
        customer_id: 'customer-booking-1',
        contact_phone: '07700900130',
        customer_first_name: null,
        customer_last_name: null,
        customer_name: null,
        contact_email: null
      },
      bookingError: null
    })

    const result = await resolveCustomerIdForSms(supabase, {
      bookingId: 'booking-3',
      to: '07700900131'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'booking_phone_mismatch'
    })
  })

  it('fails closed when private booking customer_id does not match provided customerId', async () => {
    const supabase = createResolveCustomerIdSupabaseMock({
      bookingRow: {
        id: 'booking-4',
        customer_id: 'customer-booking-2',
        contact_phone: '07700900132',
        customer_first_name: null,
        customer_last_name: null,
        customer_name: null,
        contact_email: null
      },
      bookingError: null
    })

    const result = await resolveCustomerIdForSms(supabase, {
      bookingId: 'booking-4',
      customerId: 'customer-not-booking',
      to: '07700900132'
    })

    expect(result).toEqual({
      customerId: null,
      resolutionError: 'booking_customer_mismatch'
    })
  })
})
