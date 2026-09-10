'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { eventTicketTypesEnabled, type EventTicketTypeRow } from '@/lib/events/ticket-types'

export type TicketTypeActionResult = { success?: boolean; error?: string; data?: EventTicketTypeRow }

const ticketTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500).optional().nullable(),
  base_price: z.number().finite().min(0, 'Price cannot be negative'),
  is_free_ticket: z.boolean().optional(),
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
})

async function requireEventsManage(): Promise<{ userId: string; userEmail?: string } | { error: string }> {
  const supabase = await createClient()
  const [canManage, { data: { user }, error: authError }] = await Promise.all([
    checkUserPermission('events', 'manage'),
    supabase.auth.getUser(),
  ])
  if (!canManage) return { error: 'Insufficient permissions to manage ticket types' }
  if (authError || !user) return { error: 'Unauthorized' }
  return { userId: user.id, userEmail: user.email ?? undefined }
}

/** List all ticket types for an event (view permission). */
export async function getEventTicketTypes(eventId: string): Promise<{ data?: EventTicketTypeRow[]; error?: string }> {
  try {
    const canView = await checkUserPermission('events', 'view')
    if (!canView) return { error: 'Insufficient permissions' }
    const db = createAdminClient()
    const { data, error } = await db
      .from('event_ticket_types')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    return { data: (data ?? []) as EventTicketTypeRow[] }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load ticket types' }
  }
}

/**
 * Validate that the sum of dedicated (non-null) capacities does not exceed the
 * event's overall capacity. Returns an error string or null.
 */
async function validateDedicatedCapacity(
  db: ReturnType<typeof createAdminClient>,
  eventId: string,
  excludeTypeId: string | null,
  newCapacity: number | null,
): Promise<string | null> {
  if (newCapacity === null || newCapacity === undefined) return null
  const { data: event, error: eventError } = await db.from('events').select('capacity').eq('id', eventId).single()
  if (eventError || !event) return 'Event capacity could not be checked'
  const eventCapacity = event?.capacity ?? null
  if (eventCapacity === null) return null // no hard ceiling configured
  const { data: rows, error: rowsError } = await db
    .from('event_ticket_types')
    .select('id, capacity, is_active')
    .eq('event_id', eventId)
  if (rowsError) return 'Ticket capacities could not be checked'
  let dedicatedSum = newCapacity
  for (const row of rows ?? []) {
    if (row.id === excludeTypeId) continue
    if (row.is_active && row.capacity !== null) dedicatedSum += Number(row.capacity)
  }
  if (dedicatedSum > Number(eventCapacity)) {
    return `Ticket-type capacities (${dedicatedSum}) exceed the event capacity (${eventCapacity})`
  }
  return null
}

async function validateTicketPrice(
  db: ReturnType<typeof createAdminClient>, eventId: string, price: number,
): Promise<string | null> {
  const { data: event, error } = await db.from('events')
    .select('payment_mode, online_discount_type, online_discount_value')
    .eq('id', eventId).single()
  if (error || !event) return 'Event pricing could not be checked'
  if (price > 0 && event.payment_mode === 'prepaid' && event.online_discount_type === 'fixed' && Number(event.online_discount_value ?? 0) >= price) {
    return 'Reduce the online discount before lowering this ticket price'
  }
  return null
}

export async function createEventTicketType(
  eventId: string,
  input: z.input<typeof ticketTypeSchema>,
): Promise<TicketTypeActionResult> {
  try {
    const auth = await requireEventsManage()
    if ('error' in auth) return auth

    const parsed = ticketTypeSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid ticket type' }

    const db = createAdminClient()
    if (parsed.data.base_price === 0 && parsed.data.is_free_ticket !== true) return { error: 'Choose Free ticket to set a zero price' }
    const { count: existingCount, error: countError } = await db.from('event_ticket_types').select('id', { count: 'exact', head: true }).eq('event_id', eventId)
    if (countError) return { error: 'Ticket types could not be checked' }
    if (!eventTicketTypesEnabled() && (existingCount ?? 0) > 0) return { error: 'Additional ticket types are not enabled' }
    const priceError = await validateTicketPrice(db, eventId, parsed.data.base_price)
    if (priceError) return { error: priceError }
    const capacityError = await validateDedicatedCapacity(db, eventId, null, parsed.data.capacity ?? null)
    if (capacityError) return { error: capacityError }

    const { data, error } = await db
      .from('event_ticket_types')
      .insert({
        event_id: eventId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        base_price: parsed.data.base_price,
        capacity: parsed.data.capacity ?? null,
        sort_order: parsed.data.sort_order ?? 0,
        is_active: parsed.data.is_active ?? true,
      })
      .select('*')
      .single()
    if (error) throw error

    await logAuditEvent({
      user_id: auth.userId,
      user_email: auth.userEmail,
      operation_type: 'create',
      resource_type: 'event_ticket_type',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { eventId, name: parsed.data.name },
    })
    revalidatePath(`/events/${eventId}`)
    return { success: true, data: data as EventTicketTypeRow }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create ticket type' }
  }
}

export async function updateEventTicketType(
  typeId: string,
  input: Partial<z.input<typeof ticketTypeSchema>>,
): Promise<TicketTypeActionResult> {
  try {
    const auth = await requireEventsManage()
    if ('error' in auth) return auth

    const parsed = ticketTypeSchema.partial().safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid ticket type' }

    const db = createAdminClient()
    const { data: existing, error: fetchError } = await db
      .from('event_ticket_types')
      .select('event_id, capacity, is_active')
      .eq('id', typeId)
      .single()
    if (fetchError || !existing) return { error: 'Ticket type not found' }

    if (parsed.data.base_price === 0 && parsed.data.is_free_ticket !== true) return { error: 'Choose Free ticket to set a zero price' }
    if (parsed.data.base_price !== undefined) {
      const priceError = await validateTicketPrice(db, existing.event_id, parsed.data.base_price)
      if (priceError) return { error: priceError }
    }
    const { data: activeTypes, error: activeError } = await db.from('event_ticket_types').select('id').eq('event_id', existing.event_id).eq('is_active', true).order('sort_order').order('created_at')
    if (activeError) return { error: 'Ticket types could not be checked' }
    if (!eventTicketTypesEnabled() && activeTypes?.[0]?.id !== typeId) return { error: 'Additional ticket types are not enabled' }
    if (parsed.data.is_active === false && existing.is_active && (activeTypes?.length ?? 0) <= 1) return { error: 'Keep at least one ticket type on sale' }
    if ((parsed.data.is_active ?? existing.is_active) && (parsed.data.capacity !== undefined || parsed.data.is_active === true)) {
      const capacityError = await validateDedicatedCapacity(db, existing.event_id, typeId, parsed.data.capacity === undefined ? existing.capacity : parsed.data.capacity)
      if (capacityError) return { error: capacityError }
    }

    const { is_free_ticket: _freeConfirmation, ...update } = parsed.data
    const { data, error } = await db
      .from('event_ticket_types')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', typeId)
      .select('*')
      .single()
    if (error) throw error

    await logAuditEvent({
      user_id: auth.userId,
      user_email: auth.userEmail,
      operation_type: 'update',
      resource_type: 'event_ticket_type',
      resource_id: typeId,
      operation_status: 'success',
      additional_info: { eventId: existing.event_id },
    })
    revalidatePath(`/events/${existing.event_id}`)
    return { success: true, data: data as EventTicketTypeRow }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update ticket type' }
  }
}

/**
 * Remove a ticket type. If it is referenced by any booking line it is
 * deactivated (kept for history); otherwise it is hard-deleted.
 */
export async function deleteEventTicketType(typeId: string): Promise<TicketTypeActionResult> {
  try {
    const auth = await requireEventsManage()
    if ('error' in auth) return auth

    const db = createAdminClient()
    const { data: existing } = await db
      .from('event_ticket_types')
      .select('event_id, is_active')
      .eq('id', typeId)
      .single()
    if (!existing) return { error: 'Ticket type not found' }

    if (!eventTicketTypesEnabled()) return { error: 'Removing ticket types is not enabled' }
    const { count: activeCount, error: activeError } = await db.from('event_ticket_types').select('id', { count: 'exact', head: true }).eq('event_id', existing.event_id).eq('is_active', true)
    if (activeError) return { error: 'Ticket types could not be checked' }
    if (existing.is_active && (activeCount ?? 0) <= 1) return { error: 'Keep at least one ticket type on sale' }
    const { count, error: countError } = await db
      .from('booking_items')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_type_id', typeId)

    if (countError) return { error: 'Existing bookings could not be checked' }
    let retained: EventTicketTypeRow | undefined
    if ((count ?? 0) > 0) {
      const { data, error } = await db.from('event_ticket_types').update({ is_active: false }).eq('id', typeId).select('*').single()
      if (error) throw error
      retained = data as EventTicketTypeRow
    } else {
      const { error } = await db.from('event_ticket_types').delete().eq('id', typeId)
      if (error) throw error
    }

    await logAuditEvent({
      user_id: auth.userId,
      user_email: auth.userEmail,
      operation_type: 'delete',
      resource_type: 'event_ticket_type',
      resource_id: typeId,
      operation_status: 'success',
      additional_info: { eventId: existing.event_id, deactivated: (count ?? 0) > 0 },
    })
    revalidatePath(`/events/${existing.event_id}`)
    return { success: true, data: retained }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to remove ticket type' }
  }
}
