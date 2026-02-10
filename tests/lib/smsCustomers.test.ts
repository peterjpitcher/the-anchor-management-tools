import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

type CustomerRow = {
  id: string
  mobile_e164: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type MockSupabaseOptions = {
  canonicalMatch?: CustomerRow | null
  legacyMatch?: CustomerRow | null
  insertResult?: { data: { id: string } | null; error: { code?: string; message: string } | null }
}

function createSupabaseMock(options: MockSupabaseOptions = {}) {
  const updates: Array<{ id: string; payload: Record<string, string> }> = []
  const inserts: Record<string, unknown>[] = []

  const canonicalMatch = options.canonicalMatch ?? null
  const legacyMatch = options.legacyMatch ?? null
  const insertResult = options.insertResult ?? {
    data: { id: 'new-customer' },
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
              throw new Error(`Unexpected eq column: ${column}`)
            }

            return {
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: canonicalMatch ? [canonicalMatch] : [],
                  error: null
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
                  data: legacyMatch ? [legacyMatch] : [],
                  error: null
                }))
              }))
            }
          })
        })),
        update: vi.fn((payload: Record<string, string>) => ({
          eq: vi.fn(async (column: string, id: string) => {
            if (column !== 'id') {
              throw new Error(`Unexpected update eq column: ${column}`)
            }

            updates.push({ id, payload })
            return { data: null, error: null }
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
})
