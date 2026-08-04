import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireModulePermission } from '@/lib/api/permissions'
import { logger } from '@/lib/logger'
import {
  MENU_COURSES,
  MENU_ITEM_ADDON_PRICE_MESSAGE,
  menuCourseRequiresPrice,
} from '@/lib/table-bookings/periods'

/**
 * The pre-order menu for a seasonal period.
 *
 * Ships empty on purpose. The Christmas menu is published in October and the owner loads it here.
 * Nothing invents dishes or prices. A period that requires a pre-order and has no live items is not
 * bookable, which the database enforces in `booking_period_menu_ready` and refuses to let a manager
 * switch past in `set_booking_period_active`.
 *
 * One course is not like the others. An 'addon' is an optional extra the guest ticks on top of their
 * courses and pays for on their bill at the pub, so it MUST carry a price. The form says so too, but
 * this is the check that counts: the form is only there to say it faster.
 */

const MenuItemSchema = z.object({
  id: z.string().uuid().optional(),
  period_id: z.string().uuid().optional(),
  // No default. This payload is already whole-object (`name` is required), and defaulting a missing
  // course to 'main' on an EDIT would silently refile the item: the database keeps the stored course
  // when the payload omits it, so the row would stay an add-on while this route validated it as a
  // main and let its price be cleared. Say which course it is.
  course: z.enum(MENU_COURSES, { required_error: 'Say which part of the menu this item belongs to' }),
  name: z.string().trim().min(1, 'A menu item needs a name').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  price_gbp: z.coerce.number().min(0).max(500).nullable().optional(),
  allergens: z.string().trim().max(300).optional().nullable(),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  is_active: z.boolean().default(true),
}).refine((v) => Boolean(v.id) || Boolean(v.period_id), {
  message: 'A new menu item needs the period it belongs to',
  path: ['period_id'],
}).refine(
  (v) => !menuCourseRequiresPrice(v.course) || (typeof v.price_gbp === 'number' && v.price_gbp > 0),
  { message: MENU_ITEM_ADDON_PRICE_MESSAGE, path: ['price_gbp'] },
)

const DeleteSchema = z.object({ id: z.string().uuid() })

type RpcResult = { ok?: boolean; error?: string; id?: string }

export async function POST(request: NextRequest) {
  const auth = await requireModulePermission('table_bookings', 'manage')
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = MenuItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }

  try {
    const { data, error } = await auth.supabase.rpc('upsert_booking_period_menu_item', {
      p_payload: parsed.data,
      p_actor_id: auth.userId,
    })
    if (error) throw error

    const result = (data ?? {}) as RpcResult
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Could not save the menu item' }, { status: 400 })
    }

    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    logger.error('Failed to save a booking period menu item', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Failed to save the menu item' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModulePermission('table_bookings', 'manage')
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = DeleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }

  try {
    const { data, error } = await auth.supabase.rpc('delete_booking_period_menu_item', {
      p_id: parsed.data.id,
      p_actor_id: auth.userId,
    })
    if (error) throw error

    const result = (data ?? {}) as RpcResult
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Could not remove the menu item' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove a booking period menu item', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Failed to remove the menu item' }, { status: 500 })
  }
}
