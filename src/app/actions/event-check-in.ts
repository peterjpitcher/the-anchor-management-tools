'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { formatPhoneForStorage, sanitizeName } from '@/lib/validation'
import { EventCheckInService } from '@/services/event-check-in'

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3, 'Enter a phone number'),
})

const registerExistingSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3),
  customerId: z.string().uuid(),
})

const registerNewSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional(),
})

type LookupInput = z.infer<typeof lookupSchema>
type RegisterExistingInput = z.infer<typeof registerExistingSchema>
type RegisterNewInput = z.infer<typeof registerNewSchema>

// ... (Lookup types and logic can remain or be moved to service read-only methods later)
// For this refactor, I'll keep lookup logic here as it's read-only, 
// but replace the write logic with the Service.

async function ensureEventAccess(eventId: string): Promise<{ event: { id: string; name: string; date: string; time: string } } | { error: string }> {
  const hasPermission = await checkUserPermission('events', 'manage')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage event check-ins' }
  }

  const supabase = await createClient()
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, date, time')
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    console.error('Error verifying event access:', error)
    return { error: 'Failed to load event details' }
  }

  if (!event) {
    return { error: 'Event not found' }
  }

  return { event }
}

export async function lookupEventGuest(input: LookupInput) {
  const parsed = lookupSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' }
  }

  const { eventId, phone } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  let normalizedPhone: string
  try {
    normalizedPhone = formatPhoneForStorage(phone)
  } catch (e) {
    return { success: false, error: 'Please enter a valid UK mobile number' }
  }

  try {
    const supabase = await createClient()

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, email')
      .eq('mobile_number', normalizedPhone)
      .maybeSingle()

    if (customerError) {
      console.error('Lookup customer error:', customerError)
      return { success: false, error: 'Failed to look up guest' }
    }

    if (!customer) {
      return { success: true, status: 'unknown', normalizedPhone }
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, seats')
      .eq('event_id', eventId)
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (bookingError && bookingError.code !== 'PGRST116') {
      console.error('Lookup booking error:', bookingError)
      return { success: false, error: 'Failed to look up guest booking' }
    }

    const { data: checkIn, error: checkInError } = await supabase
      .from('event_check_ins')
      .select('id')
      .eq('event_id', eventId)
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (checkInError && checkInError.code !== 'PGRST116') {
      console.error('Lookup check-in error:', checkInError)
      return { success: false, error: 'Failed to load check-in status' }
    }

    return {
      success: true,
      status: 'known',
      normalizedPhone,
      data: {
        customer,
        booking: booking ?? undefined,
        alreadyCheckedIn: Boolean(checkIn),
      },
    }
  } catch (error) {
    console.error('Unexpected lookup error:', error)
    return { success: false, error: 'Failed to look up guest' }
  }
}

export async function registerKnownGuest(input: RegisterExistingInput) {
  const parsed = registerExistingSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' }
  }

  const { eventId, phone, customerId } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'You must be signed in to check in guests' }
  }

  try {
    const result = await EventCheckInService.registerGuest({
      eventId,
      phone,
      customerId,
      staffId: user.id
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'event_check_in',
      resource_id: result.checkInId,
      operation_status: 'success',
      new_values: {
        event_id: eventId,
        customer_id: result.customerId,
        booking_id: result.bookingId,
      },
    })

    return {
      success: true,
      data: result
    }
  } catch (error: any) {
    console.error('Failed to register known guest:', error)
    return { success: false, error: error.message || 'Failed to complete check-in' }
  }
}

export async function registerNewGuest(input: RegisterNewInput) {
  const parsed = registerNewSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid guest details' }
  }

  const { eventId, phone, firstName, lastName, email } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'You must be signed in to check in guests' }
  }

  try {
    const result = await EventCheckInService.registerGuest({
      eventId,
      phone,
      firstName,
      lastName,
      email,
      staffId: user.id
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'event_check_in',
      resource_id: result.checkInId,
      operation_status: 'success',
      new_values: {
        event_id: eventId,
        customer_id: result.customerId,
        booking_id: result.bookingId,
      },
    })

    return {
      success: true,
      data: result
    }
  } catch (error: any) {
    console.error('Failed to register new guest:', error)
    return { success: false, error: error.message || 'Failed to complete check-in' }
  }
}