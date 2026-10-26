'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { parseKitchenSettings } from '@/services/kitchen-load'

/**
 * Staff's kitchen settings for a private hire or an event (owner decision D29, review BK-072): the
 * covers the kitchen cooks for it and when the food goes out. They count against the online food
 * bookings for that arrival window; left blank, a catered hire counts each guest at its start and an
 * event serving food counts each live ticket at its start.
 */

const idSchema = z.string().uuid()

async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

export async function setPrivateBookingKitchenLoad(
  bookingId: string,
  input: { covers?: string | null; foodTime?: string | null },
): Promise<{ success?: boolean; error?: string }> {
  const canEdit = await checkUserPermission('private_bookings', 'edit')
    || await checkUserPermission('private_bookings', 'manage')
  if (!canEdit) return { error: 'You do not have permission to change private bookings' }
  const user = await currentUser()
  if (!user) return { error: 'Not authenticated' }
  if (!idSchema.safeParse(bookingId).success) return { error: 'Booking not found' }

  const parsed = parseKitchenSettings(input)
  if (!parsed.ok) return { error: parsed.error }

  const admin = createAdminClient()
  const { data: current, error: readError } = await admin
    .from('private_bookings')
    .select('id, status, kitchen_covers, kitchen_food_time')
    .eq('id', bookingId)
    .maybeSingle()
  if (readError) {
    logger.error('Could not read a private booking to change its kitchen covers', {
      error: new Error(readError.message),
      metadata: { bookingId },
    })
    return { error: 'Nothing was saved: the booking could not be read. Please try again.' }
  }
  if (!current) return { error: 'Booking not found' }
  const row = current as { status: string | null; kitchen_covers: number | null; kitchen_food_time: string | null }
  if (row.status !== 'draft' && row.status !== 'confirmed') {
    return { error: 'Kitchen covers can only be changed on a draft or confirmed booking.' }
  }

  const { data: updated, error: updateError } = await admin
    .from('private_bookings')
    .update({ kitchen_covers: parsed.covers, kitchen_food_time: parsed.foodTime, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select('id')
    .maybeSingle()
  if (updateError || !updated) {
    logger.error('Could not save the kitchen covers on a private booking', {
      error: new Error(updateError?.message ?? 'no row updated'),
      metadata: { bookingId },
    })
    return { error: 'Nothing was saved. Please try again.' }
  }

  const before = { covers: row.kitchen_covers, food_time: row.kitchen_food_time ? String(row.kitchen_food_time).slice(0, 5) : null }
  const after = { covers: parsed.covers, food_time: parsed.foodTime }
  const { error: trailError } = await admin.from('private_booking_audit').insert({
    booking_id: bookingId,
    action: 'kitchen_load_changed',
    field_name: 'kitchen_covers',
    old_value: before.covers === null ? 'automatic' : String(before.covers),
    new_value: after.covers === null ? 'automatic' : String(after.covers),
    performed_by: user.id,
    metadata: { before, after },
  })
  if (trailError) {
    logger.error('Could not add the kitchen covers change to the booking history', {
      error: new Error(trailError.message),
      metadata: { bookingId },
    })
  }
  await logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'update',
    resource_type: 'private_booking',
    resource_id: bookingId,
    operation_status: 'success',
    additional_info: { action: 'kitchen_load_changed', before, after },
  })

  revalidatePath(`/private-bookings/${bookingId}`)
  revalidatePath('/table-bookings/foh')
  return { success: true }
}

export async function setEventKitchenLoad(
  eventId: string,
  input: { foodServed: boolean; covers?: string | null; foodTime?: string | null },
): Promise<{ success?: boolean; error?: string }> {
  const canManage = await checkUserPermission('events', 'manage')
  if (!canManage) return { error: 'Insufficient permissions to update events' }
  const user = await currentUser()
  if (!user) return { error: 'Not authenticated' }
  if (!idSchema.safeParse(eventId).success) return { error: 'Event not found' }

  const parsed = parseKitchenSettings(input)
  if (!parsed.ok) return { error: parsed.error }
  // Turning food off clears the number and the time: the database counts a staff number even with
  // the switch off, so the two must agree.
  const foodServed = input.foodServed === true
  const covers = foodServed ? parsed.covers : null
  const foodTime = foodServed ? parsed.foodTime : null

  const admin = createAdminClient()
  const { data: current, error: readError } = await admin
    .from('events')
    .select('id, food_served, kitchen_covers, kitchen_food_time')
    .eq('id', eventId)
    .maybeSingle()
  if (readError) {
    logger.error('Could not read an event to change its kitchen covers', {
      error: new Error(readError.message),
      metadata: { eventId },
    })
    return { error: 'Nothing was saved: the event could not be read. Please try again.' }
  }
  if (!current) return { error: 'Event not found' }

  const { data: updated, error: updateError } = await admin
    .from('events')
    .update({ food_served: foodServed, kitchen_covers: covers, kitchen_food_time: foodTime })
    .eq('id', eventId)
    .select('id')
    .maybeSingle()
  if (updateError || !updated) {
    logger.error('Could not save the kitchen covers on an event', {
      error: new Error(updateError?.message ?? 'no row updated'),
      metadata: { eventId },
    })
    return { error: 'Nothing was saved. Please try again.' }
  }

  const row = current as { food_served: boolean | null; kitchen_covers: number | null; kitchen_food_time: string | null }
  await logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'update',
    resource_type: 'event',
    resource_id: eventId,
    operation_status: 'success',
    additional_info: {
      action: 'kitchen_load_changed',
      before: { food_served: row.food_served === true, covers: row.kitchen_covers, food_time: row.kitchen_food_time ? String(row.kitchen_food_time).slice(0, 5) : null },
      after: { food_served: foodServed, covers, food_time: foodTime },
    },
  })

  revalidatePath(`/events/${eventId}`)
  revalidatePath('/table-bookings/foh')
  return { success: true }
}
