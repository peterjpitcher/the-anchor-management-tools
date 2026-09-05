import { NextRequest } from 'next/server'
import {
  createApiResponse,
  createCorsPreflightResponse,
  createErrorResponse,
  withApiAuth,
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  getPeriodOfferability,
  mapBookingPeriodRow,
  type BookingPeriod,
  type BookingPeriodRow,
} from '@/lib/table-bookings/periods'
import { resolveTableBookingDeposit } from '@/lib/table-bookings/period-deposit'

/**
 * The seasonal period that applies to a date, for the website.
 *
 * GET /api/table-bookings/periods?date=YYYY-MM-DD[&party_size=N]
 * Auth: the same API key as the other website-facing routes, permission `read:table_bookings`.
 *
 * Contract notes for the caller:
 *
 *   * `period` is null when no period is live for that date. That is the normal case for most of
 *     the year, and it is also what an INACTIVE period looks like: an inactive period is completely
 *     inert and this endpoint never mentions it.
 *   * `period.bookable` may be false on a live period, with `not_bookable_message` explaining why in
 *     plain words. The only current cause is a period that needs a pre-order whose menu has not been
 *     published. Show the message; do NOT show an empty menu.
 *   * `deposit` is present only when `party_size` is supplied. Every figure in it is computed on
 *     this server from the stored period row. The website must never compute a deposit itself.
 *   * `deposit.collect` is the kill switch. When it is false a deposit is still owed under the
 *     rules but AMS is not taking money right now, so do not present a payment step.
 *   * Answering "no" to `guest_question` is a supported answer. That guest gets the normal menu at
 *     normal terms, which is what `deposit.if_declined` prices.
 */

const PERIOD_COLUMNS =
  'id, code, period_kind, name, starts_on, ends_on, guest_question, guest_blurb, ' +
  'requires_preorder, preorder_cutoff_days, deposit_basis, deposit_amount, refund_cutoff_days, ' +
  'min_party_size, max_party_size, min_notice_hours, legacy_booking_type, is_active, archived_at'

function isValidCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  )
}

function serialiseMenuItem(item: BookingPeriod['menuItems'][number]) {
  return {
    id: item.id,
    course: item.course,
    name: item.name,
    description: item.description,
    price_gbp: item.priceGbp,
    allergens: item.allergens,
  }
}

function serialiseDeposit(
  period: BookingPeriod,
  date: string,
  partySize: number,
  bookable: boolean,
  collect: boolean,
) {
  // Two answers, because the guest has not chosen yet. `if_accepted` is null when the period cannot
  // be accepted at all for this party or date, and the reason is carried alongside it.
  //
  // `collect` is fed INTO the pricing, not merely reported beside it. Without it this endpoint
  // quoted the full seasonal deposit while the create path, which reads the same switch inside the
  // resolver, charged nothing: switch off and the guest was shown GBP 30 and charged GBP 0.
  const accepted = bookable
    ? resolveTableBookingDeposit({
        partySize,
        bookingDate: date,
        period,
        periodAccepted: true,
        collectPeriodDeposits: collect,
      })
    : null
  const declined = resolveTableBookingDeposit({
    partySize,
    bookingDate: date,
    period,
    periodAccepted: false,
    collectPeriodDeposits: collect,
  })

  return {
    party_size: partySize,
    collect,
    if_accepted:
      accepted && accepted.ok
        ? {
            required: accepted.deposit.required,
            amount: accepted.deposit.amount,
            rule: accepted.deposit.rule,
            basis: accepted.deposit.basis,
            rate: accepted.deposit.rate,
            reason: accepted.deposit.reason,
            refund_cutoff_days: accepted.deposit.refundCutoffDays,
            refund_policy: accepted.deposit.refundPolicy,
          }
        : null,
    if_accepted_rejection:
      accepted && !accepted.ok ? { code: accepted.code, message: accepted.message } : null,
    if_declined: declined.ok
      ? {
          required: declined.deposit.required,
          amount: declined.deposit.amount,
          rule: declined.deposit.rule,
          basis: declined.deposit.basis,
          rate: declined.deposit.rate,
          reason: declined.deposit.reason,
          refund_cutoff_days: declined.deposit.refundCutoffDays,
          refund_policy: declined.deposit.refundPolicy,
        }
      : null,
  }
}

/**
 * The deposit kill switch. Defaults to ON: the owner asked for collection to be live. It exists so
 * a manager can stop taking money from the settings screen without a deploy.
 *
 * An unreadable setting also reads as ON, matching `get_setting_bool(..., true)` in the SQL
 * resolver that actually charges. Reporting "not collecting" here while the create path charges
 * would have the website hide the payment step from a guest who is about to be put into
 * pending_payment, so their hold expires and the table goes back with nobody having been asked for
 * anything.
 */
async function isDepositCollectionEnabled(
  supabase: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'booking_period_deposits_enabled')
    .maybeSingle()

  if (error) {
    console.warn(
      '[periods] Could not read booking_period_deposits_enabled; reporting collection ON, which is what the database assumes',
    )
    return true
  }

  // Settings are stored wrapped, as {"value": true}. A bare boolean is read too, because a
  // switch that has been turned OFF must never come back as ON just because the row was written
  // in an older shape. Anything else means "never configured", which the owner wants to mean ON.
  const stored = data?.value ?? null
  if (typeof stored === 'boolean') return stored
  if (stored && typeof stored === 'object' && typeof (stored as { value?: unknown }).value === 'boolean') {
    return (stored as { value: boolean }).value
  }
  return true
}

export async function OPTIONS(request: NextRequest) {
  return createCorsPreflightResponse({ request, methods: 'GET, OPTIONS' })
}

export async function GET(request: NextRequest) {
  return withApiAuth(
    async (req) => {
      const url = new URL(req.url)
      const date = url.searchParams.get('date')
      const partySizeRaw = url.searchParams.get('party_size')

      if (!isValidCalendarDate(date)) {
        return createErrorResponse('Date must use YYYY-MM-DD format', 'VALIDATION_ERROR', 400)
      }

      let partySize: number | null = null
      if (partySizeRaw !== null) {
        const parsedSize = Number.parseInt(partySizeRaw, 10)
        if (!Number.isFinite(parsedSize) || parsedSize < 1 || parsedSize > 200) {
          return createErrorResponse('party_size must be between 1 and 200', 'VALIDATION_ERROR', 400)
        }
        partySize = parsedSize
      }

      const supabase = createAdminClient()

      try {
        // Only live periods are ever visible. The database exclusion constraint guarantees at most
        // one covers any date, so this is a single row by construction, not by optimism.
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
          return createApiResponse({ date, period: null, deposit: null }, 200, {}, req.method)
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
        const bookable = offerability.offerable
        const collect = await isDepositCollectionEnabled(supabase)
        // Optional capability: an older database keeps the existing seasonal journey.
        // A missing RPC never advertises unsupported one-course booking.
        let coursePolicy: unknown = null
        if (period.periodKind === 'christmas') {
          const { data, error } = await supabase.rpc('christmas_course_policy_v01', { p_booking_date: date })
          if (!error) coursePolicy = data
        }

        return createApiResponse(
          {
            date,
            period: {
              id: period.id,
              code: period.code,
              period_kind: period.periodKind,
              name: period.name,
              guest_question: period.guestQuestion,
              guest_blurb: period.guestBlurb,
              starts_on: period.startsOn,
              ends_on: period.endsOn,
              requires_preorder: period.requiresPreorder,
              course_policy: coursePolicy,
              preorder_cutoff_days: period.preorderCutoffDays,
              deposit_basis: period.depositBasis,
              deposit_amount: period.depositAmount,
              refund_cutoff_days: period.refundCutoffDays,
              min_party_size: period.minPartySize,
              max_party_size: period.maxPartySize,
              min_notice_hours: period.minNoticeHours,
              bookable,
              not_bookable_reason: bookable ? null : offerability.reason,
              not_bookable_message: bookable ? null : offerability.message,
              // Never send a half-menu. If it is not bookable there is nothing to choose from.
              menu: bookable && period.requiresPreorder ? period.menuItems.map(serialiseMenuItem) : [],
            },
            deposit:
              partySize === null
                ? null
                : serialiseDeposit(period, date, partySize, bookable, collect),
          },
          200,
          {},
          req.method,
        )
      } catch (error) {
        logger.error('Failed to load the seasonal booking period', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: { date },
        })
        return createErrorResponse('Failed to load the booking period', 'INTERNAL_ERROR', 500)
      }
    },
    ['read:table_bookings'],
    request,
  )
}
