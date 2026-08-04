/**
 * What the booker's pre-order section needs, gathered in one place.
 *
 * The manage page and its action route both need the same three answers: is the pre-order switched
 * on for this booking at all, what dishes may be chosen, and is the form still open. Gathering them
 * here keeps the page component to rendering and the route to writing.
 *
 * Add-ons come back as their own list rather than as a fourth course. A seat picks one starter, one
 * main and one dessert, but may tick as many add-ons as it likes, so they are a different question
 * and the page renders them as tick-boxes rather than as another dropdown.
 *
 * CUTOFF OWNERSHIP. The cutoff rule itself now lives in the shared library
 * (src/lib/table-bookings/preorder.ts), alongside the completeness rule and the chase rule, because
 * the staff screen, this page and the reminder cron must all give the guest the same answer.
 * `resolvePreorderCutoff` below is what is left: a rename of the shared answer into the shape this
 * page and its action route already read. It does no arithmetic and must never start doing any.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { mapMenuItemRow, type BookingPeriodMenuItem, type BookingPeriodMenuItemRow } from '@/lib/table-bookings/periods'
import { getPreorderCutoff, isPreorderEnabled, loadPreorderOrder } from '@/lib/table-bookings/preorder'
import {
  PREORDER_ADDON_COURSE,
  PREORDER_COURSES,
  type PreorderCourse,
  type PreorderOrder,
} from '@/types/preorders'

type Db = SupabaseClient<any, any, any>

export type PreorderCutoff = {
  /** Null when the period has gone, in which case the form stays open rather than locking guests out. */
  at: Date | null
  editable: boolean
}

/** The shared cutoff, in this page's vocabulary. See `getPreorderCutoff` for the rule and its why. */
export function resolvePreorderCutoff(
  bookingDate: string,
  preorderCutoffDays: number | null,
  now: Date = new Date(),
): PreorderCutoff {
  const cutoff = getPreorderCutoff({ bookingDate, preorderCutoffDays, now })
  return { at: cutoff.closesAt, editable: !cutoff.closed }
}

export type BookerPreorderView = {
  order: PreorderOrder
  /** Only live dishes, in the order the manager sorted them. A withdrawn choice is flagged instead. */
  menuByCourse: Record<PreorderCourse, BookingPeriodMenuItem[]>
  /**
   * The optional extras a seat may tick, several at a time. Empty when this menu has none, in which
   * case the page shows no add-on block at all rather than an empty one.
   */
  addons: BookingPeriodMenuItem[]
  cutoff: PreorderCutoff
}

/**
 * The booker's pre-order, or null when there is nothing to show.
 *
 * Null covers every "no section on the page" case: the feature is switched off, this booking is not
 * a seasonal one, the guest declined the seasonal offer, or the period has no live menu to choose
 * from. A guest is never shown an empty menu to pick from.
 */
export async function loadBookerPreorderView(
  supabase: Db,
  tableBookingId: string,
): Promise<BookerPreorderView | null> {
  if (!(await isPreorderEnabled(supabase))) return null

  const order = await loadPreorderOrder(supabase, tableBookingId)
  if (!order || !order.requiresPreorder || !order.periodId) return null

  const { data, error } = await supabase
    .from('booking_period_menu_items')
    .select('id, course, name, description, price_gbp, allergens, sort_order, is_active')
    .eq('period_id', order.periodId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) throw error

  const menuByCourse: Record<PreorderCourse, BookingPeriodMenuItem[]> = {
    starter: [],
    main: [],
    dessert: [],
  }

  const addons: BookingPeriodMenuItem[] = []

  for (const row of (data ?? []) as unknown as BookingPeriodMenuItemRow[]) {
    const item = mapMenuItemRow(row)
    // Sorted on the RAW course column rather than on `item.course`. `toMenuCourse` in periods.ts
    // folds any value it does not recognise into 'other'. 'addon' is on MENU_COURSES now, so the
    // mapper handles it, but the column is the truth and reading it directly means this form stays
    // right even if the two lists drift apart again.
    if (row.course === PREORDER_ADDON_COURSE) {
      addons.push(item)
    } else if ((PREORDER_COURSES as readonly string[]).includes(row.course)) {
      menuByCourse[row.course as PreorderCourse].push(item)
    }
  }

  if (menuByCourse.main.length === 0) return null

  return {
    order,
    menuByCourse,
    addons,
    cutoff: resolvePreorderCutoff(order.bookingDate, order.preorderCutoffDays),
  }
}
