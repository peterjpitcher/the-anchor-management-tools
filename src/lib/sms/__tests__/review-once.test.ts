import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getFirstVisitReviewEligibleCandidateKeys,
  hasCustomerReviewed,
  reviewVisitCandidateKey,
} from '../review-once'

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

type FakeRow = Record<string, unknown>

/**
 * Build a chained Supabase query mock that resolves with the supplied rows.
 * Supports .from().select().in().not() chaining.
 */
function makeQueryChain(rows: FakeRow[], error: unknown = null) {
  const chain: Record<string, unknown> = {}
  const result = Promise.resolve({ data: error ? null : rows, error })
  chain.select = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.not = vi.fn().mockResolvedValue({ data: error ? null : rows, error })
  chain.then = result.then.bind(result)
  chain.catch = result.catch.bind(result)
  chain.finally = result.finally.bind(result)
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

describe('getFirstVisitReviewEligibleCandidateKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows a review candidate when it is the customer first visit', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'event-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          is_reminder_only: false,
          created_at: '2026-01-01T10:00:00Z',
          event: {
            start_datetime: '2026-01-01T19:00:00Z',
            event_status: 'scheduled',
          },
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))

    const candidate = {
      channel: 'event' as const,
      bookingId: 'event-current',
      customerId: 'cust-1',
      visitAt: '2026-01-01T19:00:00Z',
    }

    const result = await getFirstVisitReviewEligibleCandidateKeys([candidate])
    expect(result.has(reviewVisitCandidateKey(candidate))).toBe(true)
  })

  it('blocks a review candidate when the customer has a prior table visit', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'event-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          is_reminder_only: false,
          created_at: '2026-01-10T10:00:00Z',
          event: {
            start_datetime: '2026-01-10T19:00:00Z',
            event_status: 'scheduled',
          },
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'table-prior',
          customer_id: 'cust-1',
          status: 'completed',
          start_datetime: '2025-12-20T13:00:00Z',
          created_at: '2025-12-01T09:00:00Z',
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))

    const candidate = {
      channel: 'event' as const,
      bookingId: 'event-current',
      customerId: 'cust-1',
      visitAt: '2026-01-10T19:00:00Z',
    }

    const result = await getFirstVisitReviewEligibleCandidateKeys([candidate])
    expect(result.has(reviewVisitCandidateKey(candidate))).toBe(false)
  })

  it('does not let a future booking suppress the first actual visit', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'event-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          is_reminder_only: false,
          created_at: '2026-01-01T10:00:00Z',
          event: {
            start_datetime: '2026-01-01T19:00:00Z',
            event_status: 'scheduled',
          },
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'table-future',
          customer_id: 'cust-1',
          status: 'confirmed',
          start_datetime: '2026-02-01T13:00:00Z',
          created_at: '2025-12-01T09:00:00Z',
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))

    const candidate = {
      channel: 'event' as const,
      bookingId: 'event-current',
      customerId: 'cust-1',
      visitAt: '2026-01-01T19:00:00Z',
    }

    const result = await getFirstVisitReviewEligibleCandidateKeys([candidate])
    expect(result.has(reviewVisitCandidateKey(candidate))).toBe(true)
  })

  it('only allows one candidate for the same customer when visits tie', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'event-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          is_reminder_only: false,
          created_at: '2026-01-01T10:00:00Z',
          event: {
            start_datetime: '2026-01-01T19:00:00Z',
            event_status: 'scheduled',
          },
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'table-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          start_datetime: '2026-01-01T19:00:00Z',
          created_at: '2026-01-01T10:00:00Z',
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([]))

    const eventCandidate = {
      channel: 'event' as const,
      bookingId: 'event-current',
      customerId: 'cust-1',
      visitAt: '2026-01-01T19:00:00Z',
    }
    const tableCandidate = {
      channel: 'table' as const,
      bookingId: 'table-current',
      customerId: 'cust-1',
      visitAt: '2026-01-01T19:00:00Z',
    }

    const result = await getFirstVisitReviewEligibleCandidateKeys([eventCandidate, tableCandidate])
    expect(result.has(reviewVisitCandidateKey(eventCandidate))).toBe(true)
    expect(result.has(reviewVisitCandidateKey(tableCandidate))).toBe(false)
  })

  it('blocks a review candidate when the customer has a prior parking visit', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'table-current',
          customer_id: 'cust-1',
          status: 'confirmed',
          start_datetime: '2026-01-10T13:00:00Z',
          created_at: '2026-01-01T09:00:00Z',
        },
      ]))
      .mockReturnValueOnce(makeQueryChain([]))
      .mockReturnValueOnce(makeQueryChain([
        {
          id: 'parking-prior',
          customer_id: 'cust-1',
          status: 'completed',
          start_at: '2025-12-15T10:00:00Z',
          created_at: '2025-12-01T09:00:00Z',
        },
      ]))

    const candidate = {
      channel: 'table' as const,
      bookingId: 'table-current',
      customerId: 'cust-1',
      visitAt: '2026-01-10T13:00:00Z',
    }

    const result = await getFirstVisitReviewEligibleCandidateKeys([candidate])
    expect(result.has(reviewVisitCandidateKey(candidate))).toBe(false)
  })
})
