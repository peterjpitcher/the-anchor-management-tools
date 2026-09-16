import { describe, expect, it } from 'vitest'
import { recalculateEngagementScoresAndLabels } from '@/lib/analytics/engagement-scoring'
import { makePagingClient, type PagingClientOptions } from './helpers/paging-client'

// The rows each read returns in production, checked on 16 September 2026, when the nightly job
// scored only the first 1,000 customers and counted only the first 1,000 event bookings. The
// booking reads skip rows with no customer, so 49 of the 69 private bookings reach the job.
const LIVE_SIZES: PagingClientOptions = {
  customers: 1153,
  bookings: 1538,
  table_bookings: 850,
  private_bookings: 49,
  waitlist_entries: 0,
}

function sumBreakdown(rows: Array<{ booking_breakdown: Record<string, number> }>, key: string): number {
  return rows.reduce((total, row) => total + (row.booking_breakdown[key] ?? 0), 0)
}

describe('recalculateEngagementScoresAndLabels paging', () => {
  it('scores every customer, not the first 1,000', async () => {
    const client = makePagingClient(LIVE_SIZES)

    const summary = await recalculateEngagementScoresAndLabels(client)

    expect(summary.processed_customers).toBe(1153)
    expect(summary.customer_scores_upserted).toBe(1153)
    expect(client.scoreRows()).toHaveLength(1153)
  })

  it('counts every booking, not the first 1,000', async () => {
    const client = makePagingClient(LIVE_SIZES)

    await recalculateEngagementScoresAndLabels(client)

    expect(sumBreakdown(client.scoreRows(), 'event')).toBe(1538)
    expect(sumBreakdown(client.scoreRows(), 'table')).toBe(850)
    expect(sumBreakdown(client.scoreRows(), 'private_confirmed')).toBe(49)
    expect(sumBreakdown(client.scoreRows(), 'scored_total')).toBe(1538 + 850 + 49)
  })

  it('asks for a second page whenever the first one comes back full', async () => {
    const client = makePagingClient(LIVE_SIZES)

    await recalculateEngagementScoresAndLabels(client)

    expect(client.rangesFor('bookings')).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(client.rangesFor('customers')).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    // A short first page is the whole set, so these stop after one request.
    expect(client.rangesFor('table_bookings')).toEqual([[0, 999]])
    expect(client.rangesFor('private_bookings')).toEqual([[0, 999]])
    expect(client.rangesFor('waitlist_entries')).toEqual([[0, 999]])
  })

  it('throws when a page fails rather than scoring a partial set', async () => {
    const client = makePagingClient({
      ...LIVE_SIZES,
      failOn: { table: 'bookings', page: 1, message: 'connection reset' },
    })

    await expect(recalculateEngagementScoresAndLabels(client)).rejects.toThrow(
      /engagement scoring event bookings failed: connection reset/,
    )
    expect(client.scoreRows()).toHaveLength(0)
  })
})
