import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'

type BookingItemType = 'main' | 'side' | 'extra'

// Typed shapes for DB rows returned by loadSundayLunchMenuItems — prevents silent
// any[] casts masking missing or malformed fields from the menu tables.
interface MenuMenuRow {
  id: string
}

interface MenuDishMenuAssignmentRow {
  dish_id: string
  category_id: string | null
  sort_order: number | null
}

interface MenuDishRow {
  id: string
  name: string
  selling_price: number | null
  is_active: boolean
}

interface MenuCategoryRow {
  id: string
  code: string | null
  name: string | null
}

interface FallbackDishRow {
  id: string
  name: string
  selling_price: number | null
}

interface LegacyMenuItemRow {
  name: string
  category: string | null
  display_order: number | null
}

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
  cutoff_overridden?: boolean
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
  return [...items].sort((a, b) => {
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

// Returns null when no menu items could be loaded (triggers menu_unavailable block in callers).
async function loadSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[] | null> {
  const { data: sundayMenuRaw, error: sundayMenuError } = await supabase.from('menu_menus')
    .select('id')
    .eq('code', 'sunday_lunch')
    .eq('is_active', true)
    .maybeSingle()

  if (!sundayMenuError && sundayMenuRaw?.id) {
    const sundayMenu = sundayMenuRaw as MenuMenuRow

    const { data: assignmentsRaw, error: assignmentsError } = await supabase.from('menu_dish_menu_assignments')
      .select('dish_id, category_id, sort_order')
      .eq('menu_id', sundayMenu.id)

    const assignmentRows: MenuDishMenuAssignmentRow[] = assignmentsError
      ? []
      : (assignmentsRaw || []) as MenuDishMenuAssignmentRow[]

    if (assignmentRows.length > 0) {
      const dishIds = Array.from(new Set(assignmentRows.map((row) => row.dish_id).filter(Boolean)))
      const categoryIds = Array.from(new Set(assignmentRows.map((row) => row.category_id).filter(Boolean)))

      const [{ data: dishesRaw }, { data: categoriesRaw }] = await Promise.all([
        supabase.from('menu_dishes')
          .select('id, name, selling_price, is_active')
          .in('id', dishIds)
          .eq('is_active', true),
        categoryIds.length > 0
          ? supabase.from('menu_categories')
              .select('id, code, name')
              .in('id', categoryIds)
          : Promise.resolve({ data: [] as MenuCategoryRow[] })
      ])

      const dishMap = new Map(
        ((dishesRaw || []) as MenuDishRow[]).map((dish) => [dish.id, dish])
      )

      const categoryMap = new Map(
        ((categoriesRaw || []) as MenuCategoryRow[]).map((category) => [category.id, category])
      )

      const menuItems: SundayMenuItem[] = []

      for (const assignment of assignmentRows) {
        const dish = dishMap.get(assignment.dish_id)
        if (!dish) continue

        // Guard: a dish row missing id or name is malformed — skip and warn rather than silently producing a broken item.
        if (!dish.id || !dish.name) {
          console.warn('[sunday-preorder] loadSundayLunchMenuItems: skipping dish with missing id or name', { dish_id: assignment.dish_id })
          continue
        }

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
  const { data: fallbackDishesRaw, error: fallbackDishesError } = await supabase.from('menu_dishes')
    .select('id, name, selling_price')
    .eq('is_active', true)
    .eq('is_sunday_lunch', true)

  if (fallbackDishesError) {
    return null
  }

  const dishRows = (fallbackDishesRaw || []) as FallbackDishRow[]

  if (dishRows.length === 0) {
    return null
  }

  const { data: legacyItemsRaw } = await supabase.from('sunday_lunch_menu_items')
    .select('name, category, display_order')
    .eq('is_active', true)

  const legacyByName = new Map(
    ((legacyItemsRaw || []) as LegacyMenuItemRow[]).map((row) => [
      row.name.trim().toLowerCase(),
      row
    ])
  )

  const fallbackMenuItems: SundayMenuItem[] = []

  for (let index = 0; index < dishRows.length; index++) {
    const dish = dishRows[index]

    // Guard: a dish row missing id or name is malformed — skip and warn.
    if (!dish.id || !dish.name) {
      console.warn('[sunday-preorder] loadSundayLunchMenuItems (fallback): skipping dish with missing id or name', { dish })
      continue
    }

    const legacy = legacyByName.get(dish.name.trim().toLowerCase())
    const categoryCode = legacy?.category || null
    const categoryName = formatCategoryName(categoryCode)

    fallbackMenuItems.push({
      menu_dish_id: dish.id,
      name: dish.name,
      price: Number(Number(dish.selling_price || 0).toFixed(2)),
      category_code: categoryCode,
      category_name: categoryName,
      item_type: resolveItemType(categoryCode),
      sort_order: Number.isFinite(Number(legacy?.display_order))
        ? Number(legacy?.display_order)
        : index
    })
  }

  if (fallbackMenuItems.length === 0) {
    return null
  }

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

  const { data: tokenRow } = await supabase.from('guest_tokens')
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

  const { data: booking } = await supabase.from('table_bookings')
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

  // Detect when a custom cutoff is set earlier than the standard 24h deadline so staff
  // can see the deadline has been overridden.
  const cutoffOverridden = Boolean(
    sundayCutoff && sundayCutoff.getTime() < cancellationDeadline.getTime()
  )
  if (cutoffOverridden) {
    console.warn(
      `[sunday-preorder] booking ${booking.id}: sunday_preorder_cutoff_at (${booking.sunday_preorder_cutoff_at}) is earlier than the 24h cancellation deadline (${cancellationDeadline.toISOString()}) — cutoff overridden`
    )
  }

  const [menuItems, existingRows] = await Promise.all([
    loadSundayLunchMenuItems(supabase),
    supabase.from('table_booking_items')
      .select('menu_dish_id, custom_item_name, price_at_booking, quantity, item_type')
      .eq('booking_id', booking.id)
      .not('menu_dish_id', 'is', null)
  ])

  if (menuItems === null) {
    return { state: 'blocked', reason: 'menu_unavailable' }
  }

  const existingItems: SundayPreorderExistingItem[] = (existingRows.data || [])
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
    cutoff_overridden: cutoffOverridden || undefined,
    existing_items: existingItems,
    menu_items: menuItems
  }
}

export async function getSundayPreorderPageDataByBookingId(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<SundayPreorderPageData> {
  const now = new Date()

  const { data: booking } = await supabase.from('table_bookings')
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

  // Detect when a custom cutoff is set earlier than the standard 24h deadline so staff
  // can see the deadline has been overridden.
  const cutoffOverridden = Boolean(
    sundayCutoff && sundayCutoff.getTime() < cancellationDeadline.getTime()
  )
  if (cutoffOverridden) {
    console.warn(
      `[sunday-preorder] booking ${booking.id}: sunday_preorder_cutoff_at (${booking.sunday_preorder_cutoff_at}) is earlier than the 24h cancellation deadline (${cancellationDeadline.toISOString()}) — cutoff overridden`
    )
  }

  const [menuItems, existingRows] = await Promise.all([
    loadSundayLunchMenuItems(supabase),
    supabase.from('table_booking_items')
      .select('menu_dish_id, custom_item_name, price_at_booking, quantity, item_type')
      .eq('booking_id', booking.id)
      .not('menu_dish_id', 'is', null)
  ])

  if (menuItems === null) {
    return { state: 'blocked', reason: 'menu_unavailable' }
  }

  const existingItems: SundayPreorderExistingItem[] = (existingRows.data || [])
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
    cutoff_overridden: cutoffOverridden || undefined,
    existing_items: existingItems,
    menu_items: menuItems
  }
}

async function saveSundayPreorderFromPageData(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    pageData: SundayPreorderPageData
    items: SundayPreorderSaveInputItem[]
    staffOverride?: boolean
  }
): Promise<SundayPreorderSaveResult> {
  const { pageData } = input
  // staffOverride: true allows staff to save after the customer-facing cutoff has passed
  if (pageData.state !== 'ready' || !pageData.booking_id || (!pageData.can_submit && !input.staffOverride)) {
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

  // Load existing menu-dish items for this booking so we can do a safe incremental
  // replace (delete removed + update/insert remaining) rather than a full delete+insert.
  // A full delete followed by insert creates a window where concurrent saves can
  // interleave: concurrent save A deletes, concurrent save B deletes, A inserts, B
  // inserts — one save silently wins. The incremental approach avoids that window.
  const { data: existingItemRows, error: existingItemsError } = await supabase.from('table_booking_items')
    .select('id, menu_dish_id')
    .eq('booking_id', pageData.booking_id)
    .not('menu_dish_id', 'is', null)

  if (existingItemsError) {
    throw existingItemsError
  }

  const existingRows = (existingItemRows || []) as Array<{ id: string; menu_dish_id: string }>
  const existingByDishId = new Map(existingRows.map((row) => [row.menu_dish_id, row.id]))

  // Delete rows whose dish is no longer in the new selection
  const dishIdsToKeep = Array.from(quantityByDish.keys())
  const rowIdsToDelete = existingRows
    .filter((row) => !quantityByDish.has(row.menu_dish_id))
    .map((row) => row.id)

  if (rowIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase.from('table_booking_items')
      .delete()
      .in('id', rowIdsToDelete)

    if (deleteError) {
      throw deleteError
    }
  }

  // Update existing rows and insert new ones — never leave a gap where all items are absent
  for (const dishId of dishIdsToKeep) {
    const quantity = quantityByDish.get(dishId)!
    const menuItem = allowedItems.get(dishId)!
    const existingRowId = existingByDishId.get(dishId)

    if (existingRowId) {
      const { error: updateError } = await supabase.from('table_booking_items')
        .update({
          custom_item_name: menuItem.name,
          price_at_booking: Number(menuItem.price.toFixed(2)),
          quantity,
          item_type: menuItem.item_type,
          updated_at: nowIso
        })
        .eq('id', existingRowId)

      if (updateError) {
        throw updateError
      }
    } else {
      const { error: insertError } = await supabase.from('table_booking_items').insert({
        booking_id: pageData.booking_id,
        menu_dish_id: dishId,
        custom_item_name: menuItem.name,
        price_at_booking: Number(menuItem.price.toFixed(2)),
        quantity,
        item_type: menuItem.item_type,
        created_at: nowIso,
        updated_at: nowIso
      })

      if (insertError) {
        throw insertError
      }
    }
  }

  const { data: updatedBooking, error: bookingUpdateError } = await supabase.from('table_bookings')
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
    item_count: dishIdsToKeep.length
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
    staffOverride?: boolean
  }
): Promise<SundayPreorderSaveResult> {
  // Defence-in-depth: refuse to persist pre-orders for non-legacy bookings.
  // The new public flow never creates `booking_type='sunday_lunch'` rows so
  // this code path should never receive one. If it does (mis-wired caller,
  // legacy data import, etc.), log loudly and bail rather than persist.
  // `getSundayPreorderPageDataByBookingId` also returns `not_sunday_lunch` —
  // this is a second guard. Spec §8.3.
  const { data: bookingRow } = await supabase.from('table_bookings')
    .select('id, booking_type')
    .eq('id', input.bookingId)
    .maybeSingle()
  if (bookingRow && bookingRow.booking_type !== 'sunday_lunch') {
    console.warn(
      `[sunday-preorder] Refusing to persist pre-order for non-legacy booking ${input.bookingId} (booking_type=${bookingRow.booking_type}). New flow does not use pre-orders.`
    )
    return { state: 'blocked', reason: 'not_sunday_lunch' }
  }

  const pageData = await getSundayPreorderPageDataByBookingId(supabase, input.bookingId)
  return saveSundayPreorderFromPageData(supabase, {
    pageData,
    items: input.items,
    staffOverride: input.staffOverride
  })
}

export async function getSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[] | null> {
  return loadSundayLunchMenuItems(supabase)
}
