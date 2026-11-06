/**
 * The Christmas food page's data: the menu panel, each guest's line and the invite ledger.
 *
 * Shared by the organiser's food section on `/g/<token>/table-manage` and the guest's own page at
 * `/g/<token>/christmas-choice`, so both show the same menu, the same prices and the same rules.
 *
 * PRICES ARE NEVER WRITTEN HERE. The tier prices live on the `christmas` menu in menu management
 * (menu_dishes, one dish per tier and day: `christmas-two-course-weekday`, `-weekend`, and the same
 * for three courses; 1 course is priced by the main). The period's own menu items carry no prices,
 * so the panel reads the menu and picks the booking's day: Tuesday to Thursday, or Friday to Sunday.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateInLondon, getIsoWeekday, isValidIsoDate } from '@/lib/dateUtils'
import { describeCoverMissingCourses, getCoverAddons, getCoverCourse, getSeatCourseCount } from '@/lib/table-bookings/preorder'
import type { BookingPeriodMenuItem } from '@/lib/table-bookings/periods'
import {
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderCover,
  type PreorderOrder,
} from '@/types/preorders'
import type { BookerPreorderView } from './preorder-data'
import type { FoodDish, FoodMenu, FoodSeatView, FoodTierPrice, FoodTierPrices } from './food-types'

type Db = SupabaseClient<any, any, any>

const CHRISTMAS_MENU_CODE = 'christmas'

function toDish(item: BookingPeriodMenuItem, childOptionIds: Set<string>): FoodDish {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    allergens: item.allergens,
    isChildOption: childOptionIds.has(item.id),
    priceGbp: item.priceGbp,
  }
}

/** The live dishes a guest can choose, with the kids mains marked. */
export function buildFoodMenu(view: Pick<BookerPreorderView, 'order' | 'menuByCourse' | 'addons'>): FoodMenu {
  const childOptionIds = new Set((view.order.menuItems ?? []).filter((item) => item.isChildOption).map((item) => item.id))
  return {
    starter: view.menuByCourse.starter.map((item) => toDish(item, childOptionIds)),
    main: view.menuByCourse.main.map((item) => toDish(item, childOptionIds)),
    dessert: view.menuByCourse.dessert.map((item) => toDish(item, childOptionIds)),
    addons: view.addons.map((item) => toDish(item, childOptionIds)),
  }
}

/** The first `guest_invite` per seat, from `booking_preorder_reminders`, keyed by cover id. */
export type FoodInviteLedger = Map<string, string>

/**
 * One resend per line. The ledger row records the first invite and never moves; the seat's
 * `invite_sent_at` moves on a resend. So a resend is still available while the two are the same
 * instant.
 */
export function canResendInvite(cover: Pick<PreorderCover, 'id' | 'inviteSentAt'> | undefined, ledger: FoodInviteLedger): boolean {
  if (!cover?.inviteSentAt) return false
  const first = ledger.get(cover.id)
  if (!first) return true
  return Date.parse(cover.inviteSentAt) <= Date.parse(first)
}

function liveCourseId(cover: PreorderCover | undefined, course: 'starter' | 'main' | 'dessert'): string | null {
  const selection = cover ? getCoverCourse(cover, course) : null
  return selection && !selection.itemWithdrawn ? selection.menuItemId : null
}

/** One guest's line from the saved order. */
export function buildFoodSeatView(
  order: Pick<PreorderOrder, 'courseCounts' | 'covers'>,
  ordinal: number,
  ledger: FoodInviteLedger = new Map(),
): FoodSeatView {
  const cover = order.covers.find((entry) => entry.ordinal === ordinal)
  const courseCount = getSeatCourseCount(order, ordinal) ?? 0
  return {
    ordinal,
    coverId: cover?.id ?? null,
    guestName: cover?.guestName ?? null,
    hasAllergies: cover?.hasAllergies ?? null,
    allergyDetail: cover?.allergyDetail ?? null,
    dietaryNote: cover?.dietaryNote ?? null,
    courseCount,
    starterId: liveCourseId(cover, 'starter'),
    mainId: liveCourseId(cover, 'main'),
    dessertId: liveCourseId(cover, 'dessert'),
    addonIds: cover ? getCoverAddons(cover).filter((addon) => !addon.itemWithdrawn).map((addon) => addon.menuItemId) : [],
    withdrawn: (cover?.selections ?? [])
      .filter((selection) => selection.itemWithdrawn)
      .map((selection) => `${PREORDER_SELECTION_COURSE_LABELS[selection.course]}: ${selection.itemName}`),
    missing: describeCoverMissingCourses({
      // The same rule as the progress count (`getPreorderCompleteness`): a withdrawn dish is flagged
      // on the line to choose again, not counted as missing.
      selections: cover?.selections ?? [],
      courseCount,
      guestName: cover?.guestName ?? null,
      hasAllergies: cover?.hasAllergies ?? null,
      allergyDetail: cover?.allergyDetail ?? null,
    }),
    lastSavedBy: cover?.lastSavedBy ?? null,
    inviteEmail: cover?.inviteEmail ?? null,
    inviteSentAt: cover?.inviteSentAt ?? null,
    canResendInvite: canResendInvite(cover, ledger),
  }
}

/** Every guest's line, seat 1 first. */
export function buildFoodSeatViews(
  order: Pick<PreorderOrder, 'courseCounts' | 'covers' | 'partySize'>,
  ledger: FoodInviteLedger = new Map(),
): FoodSeatView[] {
  return Array.from({ length: Math.max(1, order.partySize) }, (_, index) => buildFoodSeatView(order, index + 1, ledger))
}

/** The first invite per seat on this booking. */
export async function loadFoodInviteLedger(supabase: Db, tableBookingId: string): Promise<FoodInviteLedger> {
  const { data, error } = await supabase
    .from('booking_preorder_reminders')
    .select('cover_id, sent_at')
    .eq('table_booking_id', tableBookingId)
    .eq('kind', 'guest_invite')
  if (error) throw error
  const ledger: FoodInviteLedger = new Map()
  for (const row of (data ?? []) as Array<{ cover_id: string | null; sent_at: string }>) {
    if (row.cover_id) ledger.set(row.cover_id, row.sent_at)
  }
  return ledger
}

type MenuAssignmentRow = {
  dish_id: string
  category_id: string | null
  sort_order: number | null
  available_from: string | null
  available_until: string | null
}
type MenuDishRow = { id: string; slug: string | null; name: string; description: string | null; selling_price: number | string | null; is_active: boolean }
type MenuCategoryRow = { id: string; code: string }

function toPrice(value: number | string | null): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return value !== null && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null
}

/**
 * Which half of the week the booking falls in: Tuesday to Thursday is `weekday`, Friday to Sunday
 * `weekend`. Monday has no Christmas service, so it has no price.
 */
export function christmasPriceBand(bookingDate: string): 'weekday' | 'weekend' | null {
  const weekday = getIsoWeekday(bookingDate)
  if (weekday === null || weekday === 1) return null
  return weekday <= 4 ? 'weekday' : 'weekend'
}

/**
 * Each tier's price for the booking's day, from the `christmas` menu. A tier with no price for that
 * day comes back null, and the panel says to ask rather than guessing a number.
 */
export async function loadChristmasTierPrices(supabase: Db, bookingDate: string): Promise<FoodTierPrices> {
  const dayLabel = isValidIsoDate(bookingDate)
    ? formatDateInLondon(new Date(`${bookingDate}T12:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long' })
    : null
  const empty: FoodTierPrices = { dayLabel, oneCourse: [], twoCourse: null, threeCourse: null }

  const { data: menu, error: menuError } = await supabase
    .from('menu_menus')
    .select('id')
    .eq('code', CHRISTMAS_MENU_CODE)
    .maybeSingle()
  if (menuError) throw menuError
  if (!menu?.id) return empty

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from('menu_dish_menu_assignments')
    .select('dish_id, category_id, sort_order, available_from, available_until')
    .eq('menu_id', menu.id)
  if (assignmentError) throw assignmentError

  // Only what is on the menu on the booking's own date.
  const assignments = ((assignmentRows ?? []) as MenuAssignmentRow[]).filter(
    (row) => (!row.available_from || row.available_from <= bookingDate) && (!row.available_until || row.available_until >= bookingDate),
  )
  if (assignments.length === 0) return empty

  const dishIds = Array.from(new Set(assignments.map((row) => row.dish_id)))
  const categoryIds = Array.from(new Set(assignments.map((row) => row.category_id).filter((id): id is string => Boolean(id))))
  const [dishResult, categoryResult] = await Promise.all([
    supabase.from('menu_dishes').select('id, slug, name, description, selling_price, is_active').in('id', dishIds),
    categoryIds.length > 0
      ? supabase.from('menu_categories').select('id, code').in('id', categoryIds)
      : Promise.resolve({ data: [] as MenuCategoryRow[], error: null }),
  ])
  if (dishResult.error) throw dishResult.error
  if (categoryResult.error) throw categoryResult.error

  const dishes = new Map(((dishResult.data ?? []) as MenuDishRow[]).filter((dish) => dish.is_active !== false).map((dish) => [dish.id, dish]))
  const categories = new Map(((categoryResult.data ?? []) as MenuCategoryRow[]).map((category) => [category.id, category.code]))
  const band = christmasPriceBand(bookingDate)

  const oneCourse: Array<FoodTierPrice & { sort: number }> = []
  let twoCourse: FoodTierPrices['twoCourse'] = null
  let threeCourse: FoodTierPrices['threeCourse'] = null

  for (const assignment of assignments) {
    const dish = dishes.get(assignment.dish_id)
    const code = assignment.category_id ? categories.get(assignment.category_id) : undefined
    const price = dish ? toPrice(dish.selling_price) : null
    if (!dish || !code || price === null) continue

    if (code === 'christmas_one_course_adult' || code === 'christmas_one_course_kids') {
      oneCourse.push({
        name: dish.name,
        priceGbp: price,
        isKids: code === 'christmas_one_course_kids',
        sort: (code === 'christmas_one_course_kids' ? 1000 : 0) + Number(assignment.sort_order ?? 0),
      })
      continue
    }
    if (!band || !dish.slug?.endsWith(`-${band}`)) continue
    if (code === 'christmas_two_course') twoCourse = { priceGbp: price, description: dish.description }
    if (code === 'christmas_three_course') threeCourse = { priceGbp: price, description: dish.description }
  }

  return {
    dayLabel,
    oneCourse: oneCourse.sort((a, b) => a.sort - b.sort).map(({ name, priceGbp, isKids }) => ({ name, priceGbp, isKids })),
    twoCourse,
    threeCourse,
  }
}

/** "£23" or "£36.95". */
export function formatFoodPrice(priceGbp: number): string {
  return Number.isInteger(priceGbp) ? `£${priceGbp}` : `£${priceGbp.toFixed(2)}`
}
