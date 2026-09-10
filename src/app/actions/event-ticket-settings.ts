'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { bookingQuestionsSchema } from '@/lib/events/booking-questions'
import { parseLondonDateTimeLocalToIso } from '@/lib/dateUtils'

const settingsSchema = z.object({
  payment_mode: z.enum(['free', 'cash_only', 'prepaid']),
  online_discount_type: z.enum(['fixed', 'percent']).nullable(),
  online_discount_value: z.number().finite().positive().nullable(),
  online_discount_ends_at: z.string().datetime({ offset: true }).nullable(),
  booking_questions: bookingQuestionsSchema,
}).superRefine((value, ctx) => {
  if (value.online_discount_type && value.online_discount_value === null) {
    ctx.addIssue({ code: 'custom', path: ['online_discount_value'], message: 'Enter an online discount amount' })
  }
  if (value.online_discount_type === 'percent' && (value.online_discount_value ?? 0) >= 100) {
    ctx.addIssue({ code: 'custom', path: ['online_discount_value'], message: 'The discount must be less than 100%' })
  }
})

export async function saveEventTicketSettings(eventId: string, input: z.input<typeof settingsSchema>): Promise<{ success?: boolean; error?: string }> {
  try {
    const session = await createClient()
    const [allowed, { data: { user }, error: authError }] = await Promise.all([
      checkUserPermission('events', 'manage'), session.auth.getUser(),
    ])
    if (!allowed || authError || !user) return { error: 'You do not have permission to manage event tickets' }
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your ticket settings' }
    const db = createAdminClient()
    const { data: event, error: eventError } = await db.from('events').select('id, start_datetime, date, time').eq('id', eventId).single()
    if (eventError || !event) return { error: 'Event could not be loaded. Your changes have not been saved.' }
    const { data: types, error: typesError } = await db.from('event_ticket_types').select('base_price').eq('event_id', eventId).eq('is_active', true)
    if (typesError) return { error: 'Ticket prices could not be checked. Your changes have not been saved.' }
    const values = parsed.data
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
    }).eq('id', eventId)
    if (error) return { error: 'Ticket settings could not be saved. Please try again.' }
    await logAuditEvent({ user_id: user.id, user_email: user.email ?? undefined, operation_type: 'update', resource_type: 'event', resource_id: eventId, operation_status: 'success', additional_info: { changed: 'ticket_settings', questionCount: values.booking_questions.length } })
    revalidatePath(`/events/${eventId}`)
    revalidatePath('/events')
    return { success: true }
  } catch {
    return { error: 'Ticket settings could not be saved. Please try again.' }
  }
}
