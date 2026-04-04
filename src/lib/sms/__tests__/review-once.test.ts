import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasCustomerReviewed } from '../review-once'

// ---------------------------------------------------------------------------
// Mock admin client
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeRow = { customer_id: string }

/**
 * Build a chained Supabase query mock that resolves with the supplied rows.
 * Supports .from().select().in().not() chaining.
 */
function makeQueryChain(rows: FakeRow[], error: unknown = null) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.not = vi.fn().mockResolvedValue({ data: error ? null : rows, error })
  return chain
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasCustomerReviewed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an empty Set when customerIds is empty', async () => {
    const result = await hasCustomerReviewed([])
    expect(result).toEqual(new Set())
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('includes a customer who has clicked via an event booking', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-1' }])) // bookings
      .mockReturnValueOnce(makeQueryChain([]))                            // table_bookings
      .mockReturnValueOnce(makeQueryChain([]))                            // private_bookings

    const result = await hasCustomerReviewed(['cust-1', 'cust-2'])
    expect(result.has('cust-1')).toBe(true)
    expect(result.has('cust-2')).toBe(false)
  })

  it('includes a customer who has clicked via a table booking', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([]))                            // bookings
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-1' }])) // table_bookings
      .mockReturnValueOnce(makeQueryChain([]))                            // private_bookings

    const result = await hasCustomerReviewed(['cust-1'])
    expect(result.has('cust-1')).toBe(true)
  })

  it('includes a customer who has clicked via a private booking', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([]))                            // bookings
      .mockReturnValueOnce(makeQueryChain([]))                            // table_bookings
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-1' }])) // private_bookings

    const result = await hasCustomerReviewed(['cust-1'])
    expect(result.has('cust-1')).toBe(true)
  })

  it('does not include a customer with no review clicks', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))

    const result = await hasCustomerReviewed(['cust-no-click'])
    expect(result.has('cust-no-click')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('suppresses across channels: click in table booking blocks event review SMS', async () => {
    // cust-A clicked via table booking, cust-B has no clicks
    mockFrom
      .mockReturnValueOnce(makeQueryChain([]))                            // bookings: no event clicks
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-A' }])) // table_bookings: cust-A clicked
      .mockReturnValueOnce(makeQueryChain([]))                            // private_bookings

    const result = await hasCustomerReviewed(['cust-A', 'cust-B'])
    expect(result.has('cust-A')).toBe(true)
    expect(result.has('cust-B')).toBe(false)
  })

  it('handles multiple customers with clicks from different channels', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-event' }]))   // bookings
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-table' }]))   // table_bookings
      .mockReturnValueOnce(makeQueryChain([{ customer_id: 'cust-private' }])) // private_bookings

    const result = await hasCustomerReviewed(['cust-event', 'cust-table', 'cust-private', 'cust-none'])
    expect(result.has('cust-event')).toBe(true)
    expect(result.has('cust-table')).toBe(true)
    expect(result.has('cust-private')).toBe(true)
    expect(result.has('cust-none')).toBe(false)
  })
})
