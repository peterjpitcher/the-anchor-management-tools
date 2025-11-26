'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { EventCheckInService } from '@/services/event-check-in'

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  query: z.string().min(1, 'Please enter a name or number'),
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
  email: z.string().email().optional().or(z.literal('')),
})

type LookupInput = z.infer<typeof lookupSchema>
type RegisterExistingInput = z.infer<typeof registerExistingSchema>
type RegisterNewInput = z.infer<typeof registerNewSchema>

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

// Helper to clean phone search input
function normalizeSearchQuery(query: string): { isPhone: boolean, cleanQuery: string } {
  // Remove spaces, dashes, parens
  const clean = query.replace(/[\s\-()]/g, '')
  
  // Check if it looks like a phone number (mostly digits, maybe a +)
  const isPhone = /^[\d+]+$/.test(clean)
  
  if (isPhone) {
    // If it starts with 07, treat as UK mobile
    if (clean.startsWith('07')) {
      return { isPhone: true, cleanQuery: clean } // Search for exact match or stored format?
      // Stored format is +447... usually.
      // We'll search partials in DB, so leaving as is might be okay if we OR it with +44 version
    }
  }
  
  return { isPhone, cleanQuery: query.trim() }
}

export async function lookupEventGuest(input: LookupInput) {
  const parsed = lookupSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' }
  }

  const { eventId, query } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const { isPhone, cleanQuery } = normalizeSearchQuery(query)

  try {
    const supabase = await createClient()
    
    let customersQuery = supabase
      .from('customers')
      .select(`
        id, 
        first_name, 
        last_name, 
        mobile_number, 
        email,
        bookings!left(id, seats, event_id),
        event_check_ins!left(id, event_id)
      `)
      // Filter bookings and check-ins for THIS event only
      .eq('bookings.event_id', eventId)
      .eq('event_check_ins.event_id', eventId)

    if (isPhone) {
      // Phone search: Try exact, local format, and international format
      // DB stores as +447... usually
      // User might type 07... or 7...
      
      // Construct a robust OR filter for phone
      // 1. Exact match
      // 2. Ends with cleanQuery (good for "last 4 digits" etc)
      // 3. +44 + cleanQuery (without leading 0)
      
      let phoneSearch = `mobile_number.ilike.%${cleanQuery}%`
      if (cleanQuery.startsWith('0')) {
        const withoutZero = cleanQuery.substring(1)
        phoneSearch += `,mobile_number.ilike.%+44${withoutZero}%`
      }
      
      customersQuery = customersQuery.or(phoneSearch)
    } else {
      // Name/Email search
      customersQuery = customersQuery.or(`first_name.ilike.%${cleanQuery}%,last_name.ilike.%${cleanQuery}%,email.ilike.%${cleanQuery}%`)
    }

    const { data: customers, error } = await customersQuery.limit(10)

    if (error) {
      console.error('Lookup error:', error)
      return { success: false, error: 'Failed to search guests' }
    }

    // Transform results for UI
    const matches = customers?.map(c => {
      // Because of the !left join and filter, bookings array might be empty or contain the booking for this event
      // However, the .eq filter on left join in Supabase/PostgREST filters the *parent* rows if not careful, 
      // OR it just filters the child rows. 
      // Actually, strictly speaking, PostgREST embedding with filter applies to the embedded resource.
      // So c.bookings will contain ONLY bookings for this event.
      
      const booking = c.bookings?.[0] // Should be 0 or 1 for a specific event usually
      const checkIn = c.event_check_ins?.[0]

      return {
        customer: {
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          mobile_number: c.mobile_number,
          email: c.email
        },
        booking: booking ? { id: booking.id, seats: booking.seats } : undefined,
        alreadyCheckedIn: !!checkIn
      }
    }) || []

    return {
      success: true,
      matches,
      query: cleanQuery
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
      email: email || undefined,
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