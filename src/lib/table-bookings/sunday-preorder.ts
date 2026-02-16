import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'

type BookingItemType = 'main' | 'side' | 'extra'

export type SundayMenuItem = {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  category_name: string | null
  item_type: BookingItemType
  sort_order: number
}

export type SundayPreorderExistingItem = {
  menu_dish_id: string
  name_snapshot: string
  price_snapshot: number
  quantity: number
  item_type: BookingItemType
}

export type SundayPreorderPageData = {
  state: 'ready' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  booking_reference?: string | null
  start_datetime?: string | null
  party_size?: number | null
  status?: string | null
  can_submit?: boolean
  submit_deadline_at?: string | null
  cancellation_deadline_at?: string | null
  sunday_preorder_cutoff_at?: string | null
  sunday_preorder_completed_at?: string | null
  existing_items?: SundayPreorderExistingItem[]
  menu_items?: SundayMenuItem[]
}

export type SundayPreorderSaveResult = {
  state: 'saved' | 'blocked'
  reason?: string
  booking_id?: string
  item_count?: number
}

export type SundayPreorderSaveInputItem = {
  menu_dish_id: string
  quantity: number
}

function resolveAppBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function computeTokenExpiry(bookingStartIso?: string | null): string {
  const now = Date.now()
  const capMs = now + 30 * 24 * 60 * 60 * 1000
  const bookingPlus48Ms = bookingStartIso ? Date.parse(bookingStartIso) + 48 * 60 * 60 * 1000 : Number.NaN
  const fallbackMs = now + 14 * 24 * 60 * 60 * 1000

  const resolvedMs = Number.isFinite(bookingPlus48Ms)
    ? Math.min(Math.max(bookingPlus48Ms, now + 60 * 60 * 1000), capMs)
    : Math.min(fallbackMs, capMs)

  return new Date(resolvedMs).toISOString()
}

function resolveItemType(categoryCode?: string | null): BookingItemType {
  const normalized = (categoryCode || '').toLowerCase()
  if (normalized.includes('extra')) {
    return 'extra'
  }
  if (normalized.includes('side')) {
    return 'side'
  }
  return 'main'
}

function formatCategoryName(categoryCode?: string | null): string | null {
  const normalized = (categoryCode || '').trim()
  if (!normalized) return null
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sortSundayMenuItems(items: SundayMenuItem[]): SundayMenuItem[] {
  return items.sort((a, b) => {
    const categoryCompare = (a.category_name || '').localeCompare(b.category_name || '')
    if (categoryCompare !== 0) return categoryCompare
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })
}

function minDefinedDate(a?: Date | null, b?: Date | null): Date | null {
  if (a && b) {
    return a.getTime() <= b.getTime() ? a : b
  }
  return a || b || null
}

function toIsoOrNull(date?: Date | null): string | null {
  if (!date) return null
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function parseIso(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function loadSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[]> {
  const { data: sundayMenu, error: sundayMenuError } = await (supabase.from('menu_menus') as any)
    .select('id')
    .eq('code', 'sunday_lunch')
    .eq('is_active', true)
    .maybeSingle()

  if (!sundayMenuError && sundayMenu?.id) {
    const { data: assignments, error: assignmentsError } = await (supabase.from('menu_dish_menu_assignments') as any)
      .select('dish_id, category_id, sort_order')
      .eq('menu_id', sundayMenu.id)

    const assignmentRows = assignmentsError
      ? []
      : ((assignments || []) as Array<{
          dish_id: string
          category_id: string | null
          sort_order: number | null
        }>)

    if (assignmentRows.length > 0) {
      const dishIds = Array.from(new Set(assignmentRows.map((row) => row.dish_id).filter(Boolean)))
      const categoryIds = Array.from(new Set(assignmentRows.map((row) => row.category_id).filter(Boolean)))

      const [{ data: dishes }, { data: categories }] = await Promise.all([
        (supabase.from('menu_dishes') as any)
          .select('id, name, selling_price, is_active')
          .in('id', dishIds)
          .eq('is_active', true),
        categoryIds.length > 0
          ? (supabase.from('menu_categories') as any)
              .select('id, code, name')
              .in('id', categoryIds)
          : Promise.resolve({ data: [] as any[] })
      ])

      const dishMap = new Map(
        ((dishes || []) as Array<{ id: string; name: string; selling_price: number }>).map((dish) => [dish.id, dish])
      )

      const categoryMap = new Map(
        ((categories || []) as Array<{ id: string; code: string | null; name: string | null }>).map((category) => [
          category.id,
          category
        ])
      )

      const menuItems: SundayMenuItem[] = []

      for (const assignment of assignmentRows) {
        const dish = dishMap.get(assignment.dish_id)
        if (!dish) continue

        const category = assignment.category_id ? categoryMap.get(assignment.category_id) : undefined

        menuItems.push({
          menu_dish_id: dish.id,
          name: dish.name,
          price: Number(Number(dish.selling_price || 0).toFixed(2)),
          category_code: category?.code || null,
          category_name: category?.name || null,
          item_type: resolveItemType(category?.code || null),
          sort_order: Number(assignment.sort_order || 0)
        })
      }

      if (menuItems.length > 0) {
        return sortSundayMenuItems(menuItems)
      }
    }
  }

  // Fallback for older data: use active Sunday-lunch flagged dishes even if the menu
  // assignment records are missing. This keeps "Capture now" usable.
  const { data: fallbackDishes, error: fallbackDishesError } = await (supabase.from('menu_dishes') as any)
    .select('id, name, selling_price')
    .eq('is_active', true)
    .eq('is_sunday_lunch', true)

  if (fallbackDishesError) {
    return []
  }

  const dishRows = (fallbackDishes || []) as Array<{
    id: string
    name: string
    selling_price: number | null
  }>

  if (dishRows.length === 0) {
    return []
  }

  const { data: legacyItems } = await (supabase.from('sunday_lunch_menu_items') as any)
    .select('name, category, display_order')
    .eq('is_active', true)

  const legacyByName = new Map(
    ((legacyItems || []) as Array<{ name: string; category: string | null; display_order: number | null }>).map((row) => [
      row.name.trim().toLowerCase(),
      row
    ])
  )

  const fallbackMenuItems: SundayMenuItem[] = dishRows.map((dish, index) => {
    const legacy = legacyByName.get(dish.name.trim().toLowerCase())
    const categoryCode = legacy?.category || null
    const categoryName = formatCategoryName(categoryCode)

    return {
      menu_dish_id: dish.id,
      name: dish.name,
      price: Number(Number(dish.selling_price || 0).toFixed(2)),
      category_code: categoryCode,
      category_name: categoryName,
      item_type: resolveItemType(categoryCode),
      sort_order: Number.isFinite(Number(legacy?.display_order))
        ? Number(legacy?.display_order)
        : index
    }
  })

  return sortSundayMenuItems(fallbackMenuItems)
}

export async function createSundayPreorderToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    tableBookingId: string
    bookingStartIso?: string | null
    appBaseUrl?: string
  }
): Promise<{ rawToken: string; url: string; expiresAt: string }> {
  const expiresAt = computeTokenExpiry(input.bookingStartIso)
  const token = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'sunday_preorder',
    tableBookingId: input.tableBookingId,
    expiresAt
  })

  const baseUrl = resolveAppBaseUrl(input.appBaseUrl)
  return {
    rawToken: token.rawToken,
    url: `${baseUrl}/g/${token.rawToken}/sunday-preorder`,
    expiresAt
  }
}

export async function getSundayPreorderPageDataByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<SundayPreorderPageData> {
  const tokenHash = hashGuestToken(rawToken)
  const now = new Date()

  const { data: tokenRow } = await (supabase.from('guest_tokens') as any)
    .select('id, customer_id, table_booking_id, expires_at, consumed_at, action_type')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'sunday_preorder')
    .maybeSingle()

  if (!tokenRow || !tokenRow.table_booking_id) {
    return { state: 'blocked', reason: 'invalid_token' }
  }

  if (tokenRow.consumed_at) {
    return { state: 'blocked', reason: 'token_used' }
  }

  if (!tokenRow.expires_at || Date.parse(tokenRow.expires_at) <= now.getTime()) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  const { data: booking } = await (supabase.from('table_bookings') as any)
    .select(
      'id, customer_id, booking_reference, booking_type, status, party_size, start_datetime, sunday_preorder_cutoff_at, sunday_preorder_completed_at'
    )
    .eq('id', tokenRow.table_booking_id)
    .maybeSingle()

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.customer_id !== tokenRow.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  if (booking.booking_type !== 'sunday_lunch') {
    return { state: 'blocked', reason: 'not_sunday_lunch' }
  }

  if (['cancelled', 'no_show'].includes(booking.status || '')) {
    return { state: 'blocked', reason: 'booking_not_active' }
  }

  const startAt = parseIso(booking.start_datetime)
  if (!startAt) {
    return { state: 'blocked', reason: 'booking_time_missing' }
  }

  const cancellationDeadline = new Date(startAt.getTime() - 24 * 60 * 60 * 1000)
  const sundayCutoff = parseIso(booking.sunday_preorder_cutoff_at)
  const submitDeadline = minDefinedDate(cancellationDeadline, sundayCutoff)
  const canSubmit = Boolean(submitDeadline && now.getTime() < submitDeadline.getTime())

  const [menuItems, existingRows] = await Promise.all([
    loadSundayLunchMenuItems(supabase),
    (supabase.from('table_booking_items') as any)
      .select('menu_dish_id, custom_item_name, price_at_booking, quantity, item_type')
      .eq('booking_id', booking.id)
      .not('menu_dish_id', 'is', null)
  ])

  const existingItems: SundayPreorderExistingItem[] = ((existingRows.data || []) as any[])
    .filter((row) => typeof row.menu_dish_id === 'string')
    .map((row) => ({
      menu_dish_id: row.menu_dish_id,
      name_snapshot: row.custom_item_name || 'Menu item',
      price_snapshot: Number(Number(row.price_at_booking || 0).toFixed(2)),
      quantity: Math.max(1, Number(row.quantity || 1)),
      item_type: row.item_type || 'main'
    }))

  return {
    state: 'ready',
    booking_id: booking.id,
    customer_id: booking.customer_id,
    booking_reference: booking.booking_reference,
    start_datetime: booking.start_datetime,
    party_size: booking.party_size,
    status: booking.status,
    can_submit: canSubmit,
    submit_deadline_at: toIsoOrNull(submitDeadline),
    cancellation_deadline_at: toIsoOrNull(cancellationDeadline),
    sunday_preorder_cutoff_at: booking.sunday_preorder_cutoff_at || null,
    sunday_preorder_completed_at: booking.sunday_preorder_completed_at || null,
    existing_items: existingItems,
    menu_items: menuItems
  }
}

export async function getSundayPreorderPageDataByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<SundayPreorderPageData> {
  const now = new Date()

  const { data: booking } = await (supabase.from('table_bookings') as any)
    .select(
      'id, customer_id, booking_reference, booking_type, status, party_size, start_datetime, sunday_preorder_cutoff_at, sunday_preorder_completed_at'
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.booking_type !== 'sunday_lunch') {
    return { state: 'blocked', reason: 'not_sunday_lunch' }
  }

  if (['cancelled', 'no_show'].includes(booking.status || '')) {
    return { state: 'blocked', reason: 'booking_not_active' }
  }

  const startAt = parseIso(booking.start_datetime)
  if (!startAt) {
    return { state: 'blocked', reason: 'booking_time_missing' }
  }

  const cancellationDeadline = new Date(startAt.getTime() - 24 * 60 * 60 * 1000)
  const sundayCutoff = parseIso(booking.sunday_preorder_cutoff_at)
  const submitDeadline = minDefinedDate(cancellationDeadline, sundayCutoff)
  const canSubmit = Boolean(submitDeadline && now.getTime() < submitDeadline.getTime())

  const [menuItems, existingRows] = await Promise.all([
    loadSundayLunchMenuItems(supabase),
    (supabase.from('table_booking_items') as any)
      .select('menu_dish_id, custom_item_name, price_at_booking, quantity, item_type')
      .eq('booking_id', booking.id)
      .not('menu_dish_id', 'is', null)
  ])

  const existingItems: SundayPreorderExistingItem[] = ((existingRows.data || []) as any[])
    .filter((row) => typeof row.menu_dish_id === 'string')
    .map((row) => ({
      menu_dish_id: row.menu_dish_id,
      name_snapshot: row.custom_item_name || 'Menu item',
      price_snapshot: Number(Number(row.price_at_booking || 0).toFixed(2)),
      quantity: Math.max(1, Number(row.quantity || 1)),
      item_type: row.item_type || 'main'
    }))

  return {
    state: 'ready',
    booking_id: booking.id,
    customer_id: booking.customer_id,
    booking_reference: booking.booking_reference,
    start_datetime: booking.start_datetime,
    party_size: booking.party_size,
    status: booking.status,
    can_submit: canSubmit,
    submit_deadline_at: toIsoOrNull(submitDeadline),
    cancellation_deadline_at: toIsoOrNull(cancellationDeadline),
    sunday_preorder_cutoff_at: booking.sunday_preorder_cutoff_at || null,
    sunday_preorder_completed_at: booking.sunday_preorder_completed_at || null,
    existing_items: existingItems,
    menu_items: menuItems
  }
}

async function saveSundayPreorderFromPageData(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    pageData: SundayPreorderPageData
    items: SundayPreorderSaveInputItem[]
  }
): Promise<SundayPreorderSaveResult> {
  const { pageData } = input
  if (pageData.state !== 'ready' || !pageData.booking_id || !pageData.can_submit) {
    return {
      state: 'blocked',
      reason: pageData.reason || (pageData.state === 'ready' ? 'submit_cutoff_passed' : 'invalid_token')
    }
  }

  const allowedItems = new Map((pageData.menu_items || []).map((item) => [item.menu_dish_id, item]))
  const quantityByDish = new Map<string, number>()

  for (const entry of input.items || []) {
    if (!entry || typeof entry.menu_dish_id !== 'string' || !isUuid(entry.menu_dish_id)) {
      continue
    }

    const quantity = Math.max(0, Math.trunc(Number(entry.quantity || 0)))
    if (quantity <= 0) {
      continue
    }

    const existing = quantityByDish.get(entry.menu_dish_id) || 0
    quantityByDish.set(entry.menu_dish_id, existing + quantity)
  }

  if (quantityByDish.size === 0) {
    return {
      state: 'blocked',
      reason: 'empty_preorder'
    }
  }

  for (const dishId of quantityByDish.keys()) {
    if (!allowedItems.has(dishId)) {
      return {
        state: 'blocked',
        reason: 'invalid_menu_item'
      }
    }
  }

  const nowIso = new Date().toISOString()

  const { error: deleteError } = await (supabase.from('table_booking_items') as any)
    .delete()
    .eq('booking_id', pageData.booking_id)
    .not('menu_dish_id', 'is', null)

  if (deleteError) {
    throw deleteError
  }

  const insertRows = Array.from(quantityByDish.entries()).map(([dishId, quantity]) => {
    const menuItem = allowedItems.get(dishId)!

    return {
      booking_id: pageData.booking_id,
      menu_dish_id: dishId,
      custom_item_name: menuItem.name,
      price_at_booking: Number(menuItem.price.toFixed(2)),
      quantity,
      item_type: menuItem.item_type,
      created_at: nowIso,
      updated_at: nowIso
    }
  })

  const { error: insertError } = await (supabase.from('table_booking_items') as any).insert(insertRows)
  if (insertError) {
    throw insertError
  }

  const { data: updatedBooking, error: bookingUpdateError } = await (supabase.from('table_bookings') as any)
    .update({
      sunday_preorder_completed_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', pageData.booking_id)
    .select('id')
    .maybeSingle()

  if (bookingUpdateError) {
    throw bookingUpdateError
  }

  if (!updatedBooking) {
    throw new Error(`Sunday pre-order save affected no booking rows: ${pageData.booking_id}`)
  }

  return {
    state: 'saved',
    booking_id: pageData.booking_id,
    item_count: insertRows.length
  }
}

export async function saveSundayPreorderByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    items: SundayPreorderSaveInputItem[]
  }
): Promise<SundayPreorderSaveResult> {
  const pageData = await getSundayPreorderPageDataByRawToken(supabase, input.rawToken)
  return saveSundayPreorderFromPageData(supabase, {
    pageData,
    items: input.items
  })
}

export async function saveSundayPreorderByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    items: SundayPreorderSaveInputItem[]
  }
): Promise<SundayPreorderSaveResult> {
  const pageData = await getSundayPreorderPageDataByBookingId(supabase, input.bookingId)
  return saveSundayPreorderFromPageData(supabase, {
    pageData,
    items: input.items
  })
}

export async function getSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[]> {
  return loadSundayLunchMenuItems(supabase)
}
