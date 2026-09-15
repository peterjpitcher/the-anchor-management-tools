/**
 * Recalculate HMRC rate splits for every mileage trip in the tax year containing `tripDate`.
 *
 * The arithmetic lives only in the database function recalculate_mileage_tax_year_v01, which
 * locks the tax year's trips and prices them in one transaction. This wrapper keeps the callers
 * that still recalculate after a change (OJ Projects entries and trip deletes) on that single
 * implementation, instead of a second copy in TypeScript that could disagree with it.
 * Release 1 removes these callers once a database trigger recalculates in the same transaction.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export async function recalculateTaxYearMileage(tripDate: string): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.rpc('recalculate_mileage_tax_year_v01', { p_trip_date: tripDate })

  if (error) {
    console.error('[mileage] recalculate_mileage_tax_year_v01 failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error(`Failed to recalculate mileage for the tax year containing ${tripDate}: ${error.message}`)
  }
}
