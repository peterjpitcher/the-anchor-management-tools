import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * 'Delete customer' anonymises the record and keeps the opt-outs (BK-161, customer bookings review
 * of 24 October 2026). It must never hard delete a customers row, must refuse while the customer
 * has bookings coming up, and must write the opt-outs to the suppression list before anything is
 * changed.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/services/gdpr', () => ({
  GdprService: {
    resolveErasureSubject: vi.fn(),
    deleteUserData: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GdprService } from '@/services/gdpr'
import { CustomerService, describeUpcomingBookingsRefusal } from '@/services/customers'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedResolve = GdprService.resolveErasureSubject as unknown as Mock
const mockedErase = GdprService.deleteUserData as unknown as Mock

type TableAnswer = { data?: unknown; count?: number; error?: { code?: string; message: string } | null }

/** A chainable stand-in for the admin client: each table answers with a fixed result. */
function fakeAdmin(answers: Record<string, TableAnswer>, rpcAnswer: { data?: unknown; error?: unknown } = { data: 2 }) {
  const calls: string[] = []
  const deletes: string[] = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {}
    const pass = () => builder
    for (const method of ['select', 'eq', 'in', 'gte', 'or', 'update', 'order', 'limit']) {
      builder[method] = vi.fn(pass)
    }
    builder.delete = vi.fn(() => {
      deletes.push(table)
      return builder
    })
    const answer = () => {
      calls.push(table)
      const configured = answers[table] ?? { data: [], count: 0 }
      return { data: configured.data ?? null, count: configured.count ?? null, error: configured.error ?? null }
    }
    builder.maybeSingle = vi.fn(async () => answer())
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject)
    return builder
  })
  const rpc = vi.fn(async (name: string) => {
    calls.push(`rpc:${name}`)
    return { data: rpcAnswer.data ?? null, error: rpcAnswer.error ?? null }
  })
  return { client: { from, rpc }, calls, deletes, rpc }
}

const SAM = { id: 'customer-1', first_name: 'Sam', last_name: 'Smith' }
const SUBJECT = {
  profileId: null,
  profileEmail: null,
  customerIds: ['customer-1'],
  emails: ['sam@example.com'],
  phones: ['+447700900001'],
}

describe('CustomerService.deleteCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedResolve.mockResolvedValue(SUBJECT)
    mockedErase.mockResolvedValue({
      counts: { customers: 1, messages: 4 },
      unscrubbedRows: 0,
      message: 'Personal data erased. customers: 1, SMS messages: 4.',
    })
  })

  it('anonymises through the erasure path, opt-outs first, and never deletes the customers row', async () => {
    const fake = fakeAdmin({ customers: { data: SAM } })
    mockedCreateAdminClient.mockReturnValue(fake.client)

    const result = await CustomerService.deleteCustomer('customer-1')

    expect(result).toEqual({
      message: 'Personal data erased. customers: 1, SMS messages: 4.',
      counts: { customers: 1, messages: 4 },
      unscrubbedRows: 0,
    })
    expect(fake.rpc).toHaveBeenCalledWith('record_customer_contact_suppression', {
      p_customer_ids: ['customer-1'],
      p_source: 'customer_deleted',
    })
    // The opt-outs are written before vouchers are touched or anything is erased.
    expect(fake.calls.indexOf('rpc:record_customer_contact_suppression')).toBeLessThan(fake.calls.indexOf('vouchers'))
    expect(mockedErase).toHaveBeenCalledWith(expect.objectContaining({ customerIds: ['customer-1'], profileId: null }))
    expect(fake.deletes).not.toContain('customers')
  })

  it('refuses while the customer has bookings coming up, and says which', async () => {
    const fake = fakeAdmin({
      customers: { data: SAM },
      table_bookings: { count: 1 },
      bookings: { data: [{ id: 'b-1', event_id: 'e-1' }, { id: 'b-2', event_id: 'e-past' }] },
      events: { data: [{ id: 'e-1' }] },
    })
    mockedCreateAdminClient.mockReturnValue(fake.client)

    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow(
      'This customer has 1 table booking and 1 event booking coming up. Cancel or move them before deleting the customer',
    )
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(mockedErase).not.toHaveBeenCalled()
  })

  it('refuses when the upcoming booking check cannot be read', async () => {
    const fake = fakeAdmin({ customers: { data: SAM }, parking_bookings: { error: { message: 'timeout' } } })
    mockedCreateAdminClient.mockReturnValue(fake.client)

    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow(
      "Could not check the customer's upcoming bookings, so nothing was deleted",
    )
    expect(mockedErase).not.toHaveBeenCalled()
  })

  it('changes nothing when the opt-outs cannot be kept', async () => {
    const fake = fakeAdmin({ customers: { data: SAM } }, { error: { code: '42501', message: 'permission denied' } })
    mockedCreateAdminClient.mockReturnValue(fake.client)

    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow(
      "Could not keep the customer's opt-outs before erasing them",
    )
    expect(fake.calls).not.toContain('vouchers')
    expect(mockedErase).not.toHaveBeenCalled()
  })

  it('reports a missing customer and an already deleted one without erasing anything', async () => {
    mockedCreateAdminClient.mockReturnValue(fakeAdmin({ customers: { data: null } }).client)
    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow('Customer not found')

    mockedCreateAdminClient.mockReturnValue(
      fakeAdmin({ customers: { data: { id: 'customer-1', first_name: 'Erased', last_name: 'Customer' } } }).client,
    )
    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow('This customer has already been deleted.')
    expect(mockedErase).not.toHaveBeenCalled()
  })
})

describe('describeUpcomingBookingsRefusal', () => {
  it('lists each kind of booking in plain words', () => {
    expect(
      describeUpcomingBookingsRefusal({ tableBookings: 0, eventBookings: 0, privateBookings: 1, parkingBookings: 0, total: 1 }),
    ).toBe(
      'This customer has 1 private booking coming up. Cancel or move it before deleting the customer, so the booking keeps its contact details.',
    )
    expect(
      describeUpcomingBookingsRefusal({ tableBookings: 2, eventBookings: 1, privateBookings: 0, parkingBookings: 1, total: 4 }),
    ).toContain('2 table bookings, 1 event booking and 1 parking booking')
  })
})
