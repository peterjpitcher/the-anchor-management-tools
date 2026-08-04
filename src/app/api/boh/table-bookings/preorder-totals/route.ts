import { NextRequest, NextResponse } from 'next/server'

import { getLondonDateIso, requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  emptyPreorderDishTotals,
  isPreorderEnabled,
  loadPreorderDishTotals,
} from '@/lib/table-bookings/preorder'

/** Rejects bad shape *and* bad calendar dates (2026-13-45, 2026-02-31). Never coerces. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * How many of each dish the kitchen has to cook on a date, grouped by course, with add-ons counted
 * separately so a cheeseboard is never mistaken for a pudding the kitchen has to make.
 *
 * A separate route from the day list rather than another field on it: the totals are only wanted on
 * the day view, and the list is loaded for a whole month at a time.
 *
 * The pre-order tables are service-role only under RLS, so this reads through the admin client once
 * requireBohTableBookingPermission has proven the caller may see the day's bookings. It returns
 * dishes and counts only, never a guest name and never a dietary note: those belong on the booking
 * sheet and the staff screen, not in a totals panel.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  if (dateParam !== null && !isIsoDate(dateParam)) {
    return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 })
  }
  const date = dateParam ?? getLondonDateIso()

  try {
    const admin = createAdminClient()
    if (!(await isPreorderEnabled(admin))) {
      return NextResponse.json({ success: true, data: emptyPreorderDishTotals(date) })
    }

    return NextResponse.json({ success: true, data: await loadPreorderDishTotals(admin, date) })
  } catch (error) {
    console.error('Failed to load pre-order dish totals:', error)
    return NextResponse.json(
      { success: false, error: 'Could not load the pre-order totals' },
      { status: 500 }
    )
  }
}
