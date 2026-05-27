/**
 * Recalculate HMRC rate splits for all mileage trips in a given tax year.
 *
 * Called by the application layer after any mutation that affects mileage_trips
 * (both manual trip saves and OJ-Projects mileage sync). The DB trigger only
 * sets default rates as if every mile were at the standard rate; this function
 * applies the cumulative threshold logic and the date-aware standard rate
 * (£0.45 before 1 April 2026, £0.55 on or after) with £0.25 above 10,000 miles.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getTaxYearBounds, recalculateAllSplits } from './hmrcRates'

/**
 * Recalculate rate splits for every trip in the tax year that contains `tripDate`.
 * Trips are ordered by (trip_date ASC, created_at ASC) for deterministic cumulative
 * mile counting.
 *
 * @param tripDate - Any YYYY-MM-DD date; the containing tax year is derived automatically.
 */
export async function recalculateTaxYearMileage(tripDate: string): Promise<void> {
  const db = createAdminClient()
  const { start, end } = getTaxYearBounds(tripDate)

  // Fetch all trips in this tax year, ordered deterministically
  const { data: trips, error: fetchError } = await db
    .from('mileage_trips')
    .select('id, trip_date, total_miles')
    .gte('trip_date', start)
    .lte('trip_date', end)
    .order('trip_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchError) {
    throw new Error(`Failed to fetch trips for recalculation: ${fetchError.message}`)
  }

  if (!trips || trips.length === 0) return

  // Calculate new splits using the shared pure function. The trip date selects
  // the correct standard rate band (legacy £0.45 vs current £0.55).
  const splits = recalculateAllSplits(
    trips.map((t) => ({
      totalMiles: Number(t.total_miles),
      tripDate: t.trip_date,
    }))
  )

  // Batch-update each trip with its recalculated split.
  // Supabase JS client doesn't support batch updates in a single call,
  // so we issue parallel updates (all within a short window).
  const updatePromises = trips.map((trip, i) =>
    db
      .from('mileage_trips')
      .update({
        miles_at_standard_rate: splits[i].milesAtStandardRate,
        miles_at_reduced_rate: splits[i].milesAtReducedRate,
        amount_due: splits[i].amountDue,
      })
      .eq('id', trip.id)
  )

  const results = await Promise.all(updatePromises)

  // Check for any errors
  const firstError = results.find((r) => r.error)
  if (firstError?.error) {
    throw new Error(`Failed to update trip splits: ${firstError.error.message}`)
  }
}
