import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A parking booking carries the name typed for it, and the read-out carries no
 * personal details. Site review of 7 October 2026, findings PY-002 and PY-022.
 *
 * Before: the booking copied its name and email from whichever customer record
 * matched the mobile number, so a booking made with somebody else's number came
 * back with that person's first name (and surname and email when the form left
 * them blank), a typed surname replaced the one on file, and the API read-out
 * returned the whole row.
 */

const STORED = {
  id: 'customer-1',
  first_name: 'Margaret',
  last_name: 'Holloway',
  mobile_number: '+447700900123',
  mobile_e164: '+447700900123',
  email: 'margaret.holloway@example.com',
}

const insertParkingBooking = vi.hoisted(() => vi.fn())
const resolveCustomerByPhoneMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/parking/repository', () => ({
  getActiveParkingRate: vi.fn().mockResolvedValue({
    hourly_rate: 5,
    daily_rate: 15,
    weekly_rate: 75,
    monthly_rate: 250,
  }),
  insertParkingBooking,
  getParkingBooking: vi.fn(),
}))
vi.mock('@/lib/parking/capacity', () => ({
  checkParkingCapacity: vi.fn().mockResolvedValue({ remaining: 5 }),
}))

describe('the name on a parking booking is the one typed for it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    insertParkingBooking.mockImplementation(async (row: Record<string, unknown>) => ({ id: 'booking-1', ...row }))
  })

  async function create(customer: { firstName: string; lastName?: string; email?: string; mobile: string }) {
    vi.doMock('@/lib/parking/customers', () => ({ resolveCustomerByPhone: resolveCustomerByPhoneMock }))
    resolveCustomerByPhoneMock.mockResolvedValue({
      id: STORED.id,
      first_name: STORED.first_name,
      last_name: STORED.last_name,
      mobile_number: STORED.mobile_number,
      email: STORED.email,
    })
    const { createPendingParkingBooking } = await import('@/services/parking')
    await createPendingParkingBooking(
      {
        customer,
        vehicle: { registration: 'AB12 CDE' },
        startAt: '2026-11-10T09:00:00.000Z',
        endAt: '2026-11-12T09:00:00.000Z',
      },
      { client: {} as never }
    )
    return insertParkingBooking.mock.calls[0][0] as Record<string, unknown>
  }

  it('uses the typed first name, surname and email, not the ones on file for the number', async () => {
    const row = await create({
      firstName: 'Dan',
      lastName: 'Okafor',
      email: 'Dan.Okafor@Example.com',
      mobile: '07700 900123',
    })

    expect(row.customer_first_name).toBe('Dan')
    expect(row.customer_last_name).toBe('Okafor')
    expect(row.customer_email).toBe('dan.okafor@example.com')
    expect(row.customer_id).toBe('customer-1')
  })

  it('leaves surname and email blank when none were typed, never filling them from the record', async () => {
    const row = await create({ firstName: 'Dan', mobile: '07700 900123' })

    expect(row.customer_first_name).toBe('Dan')
    expect(row.customer_last_name).toBeNull()
    expect(row.customer_email).toBeNull()
    expect(JSON.stringify(row)).not.toContain('Margaret')
    expect(JSON.stringify(row)).not.toContain('Holloway')
    expect(JSON.stringify(row)).not.toContain('margaret.holloway@example.com')
  })

  it('treats spaces as nothing typed', async () => {
    const row = await create({ firstName: ' Dan ', lastName: '   ', email: '  ', mobile: '07700 900123' })

    expect(row.customer_first_name).toBe('Dan')
    expect(row.customer_last_name).toBeNull()
    expect(row.customer_email).toBeNull()
  })

  it('keeps the mobile as the stored form of the number typed', async () => {
    const row = await create({ firstName: 'Dan', mobile: '07700 900123' })

    expect(row.customer_mobile).toBe('+447700900123')
  })
})

describe('a surname on file is never changed by a parking booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('@/lib/parking/customers')
  })

  function customersTable(existing: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = []
    const supabase = {
      from: (table: string) => {
        if (table !== 'customers') throw new Error(`Unexpected table: ${table}`)
        return {
          select: () => ({
            in: () => ({ order: () => ({ limit: async () => ({ data: [existing], error: null }) }) }),
            eq: () => ({ order: () => ({ limit: async () => ({ data: [existing], error: null }) }) }),
          }),
          update: (values: Record<string, unknown>) => {
            updates.push(values)
            return {
              eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: existing.id }, error: null }) }) }),
            }
          },
        }
      },
    }
    return { supabase, updates }
  }

  it('does not replace a stored surname with a typed one', async () => {
    const { resolveCustomerByPhone } = await import('@/lib/parking/customers')
    const { supabase, updates } = customersTable(STORED)

    const result = await resolveCustomerByPhone(supabase as never, {
      firstName: 'Dan',
      lastName: 'Okafor',
      phone: '+447700900123',
    })

    expect(updates.filter((values) => 'last_name' in values)).toEqual([])
    expect(result.last_name).toBe('Holloway')
  })

  it('does not replace it when only the capitals differ', async () => {
    const { resolveCustomerByPhone } = await import('@/lib/parking/customers')
    const { supabase, updates } = customersTable(STORED)

    await resolveCustomerByPhone(supabase as never, {
      firstName: 'Margaret',
      lastName: 'HOLLOWAY',
      phone: '+447700900123',
    })

    expect(updates.filter((values) => 'last_name' in values)).toEqual([])
  })

  it.each([[null], [''], ['   ']])('still fills in a surname that is blank on file (%j)', async (blank) => {
    const { resolveCustomerByPhone } = await import('@/lib/parking/customers')
    const { supabase, updates } = customersTable({ ...STORED, last_name: blank })

    const result = await resolveCustomerByPhone(supabase as never, {
      firstName: 'Margaret',
      lastName: 'Holloway',
      phone: '+447700900123',
    })

    expect(updates).toContainEqual({ last_name: 'Holloway' })
    expect(result.last_name).toBe('Holloway')
  })

  it('never changes the stored first name', async () => {
    const { resolveCustomerByPhone } = await import('@/lib/parking/customers')
    const { supabase, updates } = customersTable(STORED)

    await resolveCustomerByPhone(supabase as never, {
      firstName: 'Dan',
      lastName: 'Okafor',
      phone: '+447700900123',
    })

    expect(updates.filter((values) => 'first_name' in values)).toEqual([])
  })
})
