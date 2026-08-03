import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  getPeriodOfferability,
  mapBookingPeriodRow,
  type BookingPeriod,
  type BookingPeriodRow,
} from '@/lib/table-bookings/periods'

/**
 * The seasonal period that applies to a date, for STAFF.
 *
 * The public route at /api/table-bookings/periods is API-key authenticated and
 * meant for the website. The FOH screen runs inside AMS on a staff session, so
 * it authenticates the same way every other /api/foh route does rather than
 * putting an API key in a browser the whole team shares.
 *
 * Deliberately thinner than the public route: no deposit block. Staff take the
 * deposit through the existing FOH deposit controls, which already price it, and
 * a second quote here would be a second opinion about money.
 *
 * GET /api/foh/periods?date=YYYY-MM-DD
 */

const PERIOD_COLUMNS =
  'id, code, period_kind, name, starts_on, ends_on, guest_question, guest_blurb, ' +
  'requires_preorder, preorder_cutoff_days, deposit_basis, deposit_amount, refund_cutoff_days, ' +
  'min_party_size, max_party_size, min_notice_hours, legacy_booking_type, is_active, archived_at'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const date = request.nextUrl.searchParams.get('date') || ''
  if (!isIsoDate(date)) {
    return NextResponse.json(
      { success: false, error: 'Date must use YYYY-MM-DD format' },
      { status: 400 }
    )
  }

  try {
    const supabase = createAdminClient()

    // Only live periods are visible, and the database exclusion constraint
    // guarantees at most one covers any date, so this is a single row by
    // construction rather than by optimism.
    const { data: periodRow, error: periodError } = await supabase
      .from('booking_periods')
      .select(PERIOD_COLUMNS)
      .eq('is_active', true)
      .is('archived_at', null)
      .lte('starts_on', date)
      .gte('ends_on', date)
      .maybeSingle()

    if (periodError) throw periodError
    if (!periodRow) {
      return NextResponse.json({ success: true, data: { date, period: null } })
    }

    const rawPeriod = periodRow as unknown as BookingPeriodRow

    const { data: menuRows, error: menuError } = await supabase
      .from('booking_period_menu_items')
      .select('id, course, name, description, price_gbp, allergens, sort_order, is_active')
      .eq('period_id', rawPeriod.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (menuError) throw menuError

    const period: BookingPeriod = mapBookingPeriodRow({
      ...rawPeriod,
      menu_items: menuRows ?? [],
    })

    const offerability = getPeriodOfferability(period, date)

    return NextResponse.json({
      success: true,
      data: {
        date,
        period: {
          id: period.id,
          code: period.code,
          period_kind: period.periodKind,
          name: period.name,
          guest_question: period.guestQuestion,
          guest_blurb: period.guestBlurb,
          requires_preorder: period.requiresPreorder,
          min_party_size: period.minPartySize,
          max_party_size: period.maxPartySize,
          bookable: offerability.offerable,
          not_bookable_reason: offerability.offerable ? null : offerability.reason,
          not_bookable_message: offerability.offerable ? null : offerability.message,
        },
      },
    })
  } catch (error) {
    logger.error('Failed to load the seasonal booking period for FOH', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { date },
    })
    return NextResponse.json(
      { success: false, error: 'Failed to load the booking period' },
      { status: 500 }
    )
  }
}
