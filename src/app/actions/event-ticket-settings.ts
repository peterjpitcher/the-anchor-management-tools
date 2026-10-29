'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { bookingQuestionsSchema } from '@/lib/events/booking-questions'
import { parseLondonDateTimeLocalToIso } from '@/lib/dateUtils'
import { DOOR_LIST_EXCLUDED_STATUS_FILTER } from '@/lib/events/door-list'
import { countActiveEventBookings, EVENT_PAYMENT_MODE_LOCKED_MESSAGE } from '@/lib/events/event-change-guard'
import { isPaymentModeLockedError } from '@/lib/events/event-change-refusal'

const settingsSchema = z.object({
  payment_mode: z.enum(['free', 'cash_only', 'prepaid']),
  online_discount_type: z.enum(['fixed', 'percent']).nullable(),
  online_discount_value: z.number().finite().positive().nullable(),
  online_discount_ends_at: z.string().datetime({ offset: true }).nullable(),
  booking_questions: bookingQuestionsSchema,
  // Ask for each ticket's name and answers (BK-014, owner decision D4).
  collect_guest_details: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.online_discount_type && value.online_discount_value === null) {
    ctx.addIssue({ code: 'custom', path: ['online_discount_value'], message: 'Enter an online discount amount' })
  }
  if (value.online_discount_type === 'percent' && (value.online_discount_value ?? 0) >= 100) {
    ctx.addIssue({ code: 'custom', path: ['online_discount_value'], message: 'The discount must be less than 100%' })
  }
  // Questions are asked of each guest, so they only reach anyone when guest details are on.
  // Without this, a question could be saved that no booking ever asks.
  if (value.payment_mode !== 'free' && value.booking_questions.length > 0 && !value.collect_guest_details) {
    ctx.addIssue({ code: 'custom', path: ['collect_guest_details'], message: 'Guest questions are asked of each guest. Switch on guest details, or remove the questions.' })
  }
})

export async function saveEventTicketSettings(eventId: string, input: z.input<typeof settingsSchema>): Promise<{ success?: boolean; error?: string; warning?: string }> {
  try {
    const session = await createClient()
    const [allowed, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'manage'), session.auth.getUser(),
    ])
    if (!allowed || authError || !user) return { error: 'You do not have permission to manage event tickets' }
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your ticket settings' }
    const db = createAdminClient()
    const { data: event, error: eventError } = await db.from('events')
      .select('id, start_datetime, date, time, booking_questions, payment_mode, is_free, online_discount_type, online_discount_value, online_discount_ends_at, collect_guest_details')
      .eq('id', eventId).single()
    if (eventError || !event) return { error: 'Event could not be loaded. Your changes have not been saved.' }
    const { data: types, error: typesError } = await db.from('event_ticket_types').select('base_price').eq('event_id', eventId).eq('is_active', true)
    if (typesError) return { error: 'Ticket prices could not be checked. Your changes have not been saved.' }
    const values = parsed.data
    // Owner decision D9: once anyone has booked, the payment method is locked so every guest keeps
    // the terms they booked under. The database refuses it too (zz_guard_event_payment_mode_locked).
    if (values.payment_mode !== (event.payment_mode ?? 'free')) {
      let active: { bookings: number }
      try {
        active = await countActiveEventBookings(db, eventId)
      } catch {
        return { error: 'Existing bookings could not be checked. Your changes have not been saved.' }
      }
      if (active.bookings > 0) return { error: EVENT_PAYMENT_MODE_LOCKED_MESSAGE }
    }
    const prices = (types ?? []).map(type => Number(type.base_price))
    if (values.payment_mode === 'free' && prices.some(price => price > 0)) return { error: 'Make each ticket type free before choosing free entry' }
    if (values.payment_mode !== 'free' && !prices.some(price => price > 0)) return { error: 'Set a paid ticket price before choosing a payment method' }
    if (values.payment_mode === 'prepaid' && values.online_discount_type === 'fixed' && prices.some(price => price > 0 && price <= (values.online_discount_value ?? 0))) {
      return { error: 'The online discount must be less than every paid ticket price' }
    }
    const discountActive = values.payment_mode === 'prepaid' && values.online_discount_type !== null
    const eventStart = event.start_datetime || (event.date && event.time ? parseLondonDateTimeLocalToIso(`${event.date}T${event.time}`) : null)
    if (discountActive && values.online_discount_ends_at && eventStart && Date.parse(values.online_discount_ends_at) > Date.parse(eventStart)) {
      return { error: 'The online discount must end by the event start time' }
    }
    const { error } = await db.from('events').update({
      payment_mode: values.payment_mode,
      is_free: values.payment_mode === 'free',
      online_discount_type: discountActive ? values.online_discount_type : null,
      online_discount_value: discountActive ? values.online_discount_value : null,
      online_discount_ends_at: discountActive ? values.online_discount_ends_at : null,
      booking_questions: values.payment_mode === 'free' ? [] : values.booking_questions,
      // Free entry asks for nothing; null puts the event back on the default if it is ever paid.
      collect_guest_details: values.payment_mode === 'free' ? null : values.collect_guest_details,
    }).eq('id', eventId)
    if (error) {
      if (isPaymentModeLockedError(error)) return { error: EVENT_PAYMENT_MODE_LOCKED_MESSAGE }
      return { error: 'Ticket settings could not be saved. Please try again.' }
    }
    // Before and after values, so a dispute about what a guest was charged can be answered (BK-139).
    const saved = {
      payment_mode: values.payment_mode,
      online_discount_type: discountActive ? values.online_discount_type : null,
      online_discount_value: discountActive ? values.online_discount_value : null,
      online_discount_ends_at: discountActive ? values.online_discount_ends_at : null,
      collect_guest_details: values.payment_mode === 'free' ? null : values.collect_guest_details,
    }
    const previous: Record<string, unknown> = {
      payment_mode: event.payment_mode ?? null,
      online_discount_type: event.online_discount_type ?? null,
      online_discount_value: event.online_discount_value ?? null,
      online_discount_ends_at: event.online_discount_ends_at ?? null,
      collect_guest_details: event.collect_guest_details ?? null,
    }
    const changedKeys = (Object.keys(saved) as Array<keyof typeof saved>).filter(key => String(previous[key] ?? '') !== String(saved[key] ?? ''))
    let bookedBefore = 0
    if (changedKeys.length > 0) {
      try { bookedBefore = (await countActiveEventBookings(db, eventId)).bookings } catch { bookedBefore = 0 }
    }
    await logAuditEvent({
      user_id: user.id, user_email: user.email ?? undefined, operation_type: 'update', resource_type: 'event', resource_id: eventId, operation_status: 'success',
      ...(changedKeys.length > 0 ? {
        old_values: Object.fromEntries(changedKeys.map(key => [key, previous[key] ?? null])),
        new_values: Object.fromEntries(changedKeys.map(key => [key, saved[key] ?? null])),
      } : {}),
      additional_info: { changed: 'ticket_settings', questionCount: values.booking_questions.length, collectGuestDetails: values.payment_mode === 'free' ? null : values.collect_guest_details, changed_after_first_booking: changedKeys.length > 0 && bookedBefore > 0 },
    })
    revalidatePath(`/events/${eventId}`)
    revalidatePath('/events')
    // BK-016: a question added now is not asked of anyone already booked. Say how many bookings
    // that is, so staff can add their answers from each booking. The save itself has happened.
    const previousIds = new Set((Array.isArray(event.booking_questions) ? event.booking_questions as Array<{ id?: string }> : []).map(question => question?.id))
    const added = values.payment_mode === 'free' ? [] : values.booking_questions.filter(question => !previousIds.has(question.id))
    if (added.length > 0) {
      const { count, error: countError } = await db.from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('is_reminder_only', false)
        .not('status', 'in', DOOR_LIST_EXCLUDED_STATUS_FILTER)
      if (countError) {
        return { success: true, warning: 'Saved. Bookings already made were not checked, so some guests may not have been asked the new question.' }
      }
      if ((count ?? 0) > 0) {
        return {
          success: true,
          warning: `Saved. ${count} ${count === 1 ? 'booking was' : 'bookings were'} made before ${added.length === 1 ? 'this question' : 'these questions'}, so those guests have not been asked. Add their answers from each booking's guest details.`,
        }
      }
    }
    return { success: true }
  } catch {
    return { error: 'Ticket settings could not be saved. Please try again.' }
  }
}
