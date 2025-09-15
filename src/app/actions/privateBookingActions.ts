'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { 
  PrivateBookingWithDetails,
  BookingStatus
} from '@/types/private-bookings'
import { syncCalendarEvent, deleteCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar'
import { queueAndSendPrivateBookingSms } from './private-booking-sms'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

// Helper function to format time to HH:MM
function formatTimeToHHMM(time: string | undefined): string | undefined {
  if (!time) return undefined
  
  // If time is already in correct format, return it
  if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return time
  }
  
  // Parse and format time
  const [hours, minutes] = time.split(':')
  const formattedHours = hours.padStart(2, '0')
  const formattedMinutes = (minutes || '00').padStart(2, '0')
  
  return `${formattedHours}:${formattedMinutes}`
}

// Time validation schema
const timeSchema = z.string().regex(
  /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
  'Time must be in HH:MM format (24-hour)'
)

// Private booking validation schema
const privateBookingSchema = z.object({
  customer_first_name: z.string().min(1, 'First name is required'),
  customer_last_name: z.string().optional(),
  customer_id: z.string().uuid().optional().nullable(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email('Invalid email format').optional().or(z.literal('')),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  start_time: timeSchema,
  setup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  setup_time: timeSchema.optional().or(z.literal('')),
  end_time: timeSchema.optional().or(z.literal('')),
  guest_count: z.number().min(0, 'Guest count cannot be negative').optional(),
  event_type: z.string().optional(),
  internal_notes: z.string().optional(),
  customer_requests: z.string().optional(),
  special_requirements: z.string().optional(),
  accessibility_needs: z.string().optional(),
  source: z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  balance_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().or(z.literal('')),
  status: z.enum(['draft', 'confirmed', 'completed', 'cancelled']).optional()
})

// Customer creation schema
const CreateCustomerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  mobile_number: z.string().min(10),
  email: z.string().email().optional(),
  sms_opt_in: z.boolean().default(true),
})

// Helper function to find or create customer
async function findOrCreateCustomer(
  supabase: any,
  customerData: z.infer<typeof CreateCustomerSchema>
) {
  const standardizedPhone = formatPhoneForStorage(customerData.mobile_number);
  const phoneVariants = generatePhoneVariants(standardizedPhone);
  
  // Try to find existing customer
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
    .single();
    
  if (existingCustomer) {
    // Update opt-in status if changed
    if (customerData.sms_opt_in !== existingCustomer.sms_opt_in) {
      await supabase
        .from('customers')
        .update({ sms_opt_in: customerData.sms_opt_in })
        .eq('id', existingCustomer.id);
    }
    return existingCustomer;
  }
  
  // Create new customer
  const { data: newCustomer, error } = await supabase
    .from('customers')
    .insert({
      ...customerData,
      mobile_number: standardizedPhone,
    })
    .select()
    .single();
    
  if (error) {
    throw new Error('Failed to create customer');
  }
  
  return newCustomer;
}

// Get all private bookings with optional filtering
export async function getPrivateBookings(filters?: {
  status?: BookingStatus
  fromDate?: string
  toDate?: string
  customerId?: string
}) {
  const supabase = await createClient()
  
  let query = supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(id, first_name, last_name, mobile_number),
      items:private_booking_items(
        *,
        space:venue_spaces(*),
        package:catering_packages(*),
        vendor:vendors(*)
      )
    `)
    .order('event_date', { ascending: true })

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  
  if (filters?.fromDate) {
    query = query.gte('event_date', filters.fromDate)
  }
  
  if (filters?.toDate) {
    query = query.lte('event_date', filters.toDate)
  }
  
  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching private bookings:', error)
    return { error: error.message || 'An error occurred' }
  }

  // Calculate additional fields for each booking
  const bookingsWithDetails: PrivateBookingWithDetails[] = (data || []).map(booking => {
    const calculatedTotal = booking.items?.reduce((sum: number, item: any) => 
      sum + (item.line_total || 0), 0) || 0
    
    const eventDate = new Date(booking.event_date)
    const today = new Date()
    const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    const depositStatus = booking.deposit_paid_date ? 'Paid' : 
      booking.deposit_amount > 0 ? 'Required' : 'Not Required'

    return {
      ...booking,
      calculated_total: calculatedTotal,
      deposit_status: depositStatus,
      days_until_event: daysUntilEvent
    }
  })

  return { data: bookingsWithDetails }
}

// Get single private booking by ID
export async function getPrivateBooking(id: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(id, first_name, last_name, mobile_number),
      items:private_booking_items(
        *,
        space:venue_spaces(*),
        package:catering_packages(*),
        vendor:vendors(*)
      ),
      documents:private_booking_documents(*),
      sms_queue:private_booking_sms_queue(*)
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching private booking:', error)
    return { error: error.message || 'An error occurred' }
  }

  // Calculate additional fields
  const calculatedTotal = data.items?.reduce((sum: number, item: any) => 
    sum + (item.line_total || 0), 0) || 0
  
  const eventDate = new Date(data.event_date)
  const today = new Date()
  const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  const depositStatus = data.deposit_paid_date ? 'Paid' : 
    data.deposit_amount > 0 ? 'Required' : 'Not Required'

  const bookingWithDetails: PrivateBookingWithDetails = {
    ...data,
    calculated_total: calculatedTotal,
    deposit_status: depositStatus,
    days_until_event: daysUntilEvent
  }

  return { data: bookingWithDetails }
}

// Create a new private booking
export async function createPrivateBooking(formData: FormData) {
  const supabase = await createClient()
  
  // Parse form data
  const rawData = {
    customer_first_name: formData.get('customer_first_name') as string,
    customer_last_name: formData.get('customer_last_name') as string || undefined,
    customer_id: formData.get('customer_id') as string || undefined,
    contact_phone: formData.get('contact_phone') as string || undefined,
    contact_email: formData.get('contact_email') as string || undefined,
    event_date: formData.get('event_date') as string,
    start_time: formatTimeToHHMM(formData.get('start_time') as string) || formData.get('start_time') as string,
    setup_date: formData.get('setup_date') as string || undefined,
    setup_time: formatTimeToHHMM(formData.get('setup_time') as string || undefined),
    end_time: formatTimeToHHMM(formData.get('end_time') as string || undefined),
    guest_count: formData.get('guest_count') ? parseInt(formData.get('guest_count') as string) : undefined,
    event_type: formData.get('event_type') as string || undefined,
    internal_notes: formData.get('internal_notes') as string || undefined,
    customer_requests: formData.get('customer_requests') as string || undefined,
    special_requirements: formData.get('special_requirements') as string || undefined,
    accessibility_needs: formData.get('accessibility_needs') as string || undefined,
    source: formData.get('source') as string || undefined,
    deposit_amount: formData.get('deposit_amount') ? parseFloat(formData.get('deposit_amount') as string) : undefined,
    balance_due_date: formData.get('balance_due_date') as string || undefined,
  }

  // Debug logging for time fields
  console.log('Raw booking data times:', {
    start_time: rawData.start_time,
    end_time: rawData.end_time,
    customer_id: rawData.customer_id,
    is_new_customer: !rawData.customer_id
  })

  // Validate data
  const validationResult = privateBookingSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const bookingData = validationResult.data

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  // Find or create customer if not already selected
  let customerId = bookingData.customer_id
  if (!customerId && bookingData.customer_first_name && bookingData.contact_phone) {
    try {
      const customerData = {
        first_name: bookingData.customer_first_name,
        last_name: bookingData.customer_last_name || '',
        mobile_number: bookingData.contact_phone,
        email: bookingData.contact_email,
        sms_opt_in: true, // Default to true for private bookings
      }
      
      const customer = await findOrCreateCustomer(supabase, customerData)
      customerId = customer.id
      
      console.log('Customer found/created:', { 
        id: customer.id, 
        isNew: !bookingData.customer_id,
        name: `${customer.first_name} ${customer.last_name}`
      })
    } catch (error) {
      console.error('Error creating/finding customer:', error)
      // Continue without linking to customer - maintain backward compatibility
    }
  }
  
  // Calculate balance_due_date if not provided (7 days before event)
  let balance_due_date = bookingData.balance_due_date
  if (!balance_due_date && bookingData.event_date) {
    const eventDate = new Date(bookingData.event_date)
    eventDate.setDate(eventDate.getDate() - 7)
    balance_due_date = eventDate.toISOString().split('T')[0]
  }

  // Construct customer_name for backward compatibility
  const customer_name = bookingData.customer_last_name 
    ? `${bookingData.customer_first_name} ${bookingData.customer_last_name}`
    : bookingData.customer_first_name

  // Clean up empty strings for time fields
  // Special handling for end_time to ensure it's valid
  let cleanedEndTime = bookingData.end_time || null;
  
  // If end_time exists but is the same or before start_time, set it to null
  if (cleanedEndTime && bookingData.start_time) {
    const [startHour, startMin] = bookingData.start_time.split(':').map(Number);
    const [endHour, endMin] = cleanedEndTime.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    if (endMinutes <= startMinutes) {
      console.warn('End time is not after start time, setting to null', {
        start_time: bookingData.start_time,
        end_time: cleanedEndTime,
        startMinutes,
        endMinutes
      });
      cleanedEndTime = null;
    }
  }
  
  const cleanedBookingData = {
    ...bookingData,
    setup_time: bookingData.setup_time || null,
    end_time: cleanedEndTime,
    setup_date: bookingData.setup_date || null,
    balance_due_date: bookingData.balance_due_date || balance_due_date || null,
  }

  const insertData = {
    ...cleanedBookingData,
    customer_id: customerId || null, // Include the found/created customer ID
    customer_name, // Include for backward compatibility
    balance_due_date: cleanedBookingData.balance_due_date,
    deposit_amount: bookingData.deposit_amount || 250, // Default £250 if not specified
    created_by: user?.id,
    status: 'draft'
  }

  // Debug logging for database insert
  console.log('Inserting booking with data:', {
    start_time: insertData.start_time,
    end_time: insertData.end_time,
    customer_id: insertData.customer_id,
    is_new_customer: !insertData.customer_id
  })

  const { data, error } = await supabase
    .from('private_bookings')
    .insert(insertData)
    .select()
    .single()

  if (error) {
    console.error('Error creating private booking:', error)
    console.error('Insert data that caused error:', insertData)
    return { error: error.message || 'An error occurred' }
  }

  // Queue and auto-send booking creation SMS if phone number is provided
  if (data && bookingData.contact_phone) {
    const eventDate = new Date(bookingData.event_date).toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    
    const smsMessage = `Hi ${bookingData.customer_first_name}, thank you for your enquiry about private hire at The Anchor on ${eventDate}. To secure this date, a deposit of £${bookingData.deposit_amount || 250} is required. Reply to this message with any questions.`
    
    const smsResult = await queueAndSendPrivateBookingSms({
      booking_id: data.id,
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: smsMessage,
      customer_phone: bookingData.contact_phone,
      customer_name: customer_name,
      created_by: user?.id,
      priority: 2,
      metadata: {
        template: 'private_booking_created',
        first_name: bookingData.customer_first_name,
        event_date: eventDate,
        deposit_amount: bookingData.deposit_amount || 250
      }
    })
    
    if (smsResult.error) {
      console.error('Error sending booking creation SMS:', smsResult.error)
    } else if (smsResult.sent) {
      console.log('Booking creation SMS sent successfully')
    }
  }

  // Sync with Google Calendar if configured
  console.log('[privateBookingActions] Checking calendar sync for new booking:', {
    hasData: !!data,
    bookingId: data?.id,
    isConfigured: isCalendarConfigured()
  })
  
  if (data && isCalendarConfigured()) {
    console.log('[privateBookingActions] Initiating calendar sync for new booking:', data.id)
    try {
      const eventId = await syncCalendarEvent(data)
      console.log('[privateBookingActions] Calendar sync result:', {
        bookingId: data.id,
        eventId: eventId,
        success: !!eventId
      })
      
      if (eventId) {
        // Update the booking with the calendar event ID
        console.log('[privateBookingActions] Updating booking with calendar event ID:', eventId)
        const { error: updateError } = await supabase
          .from('private_bookings')
          .update({ calendar_event_id: eventId })
          .eq('id', data.id)
        
        if (updateError) {
          console.error('[privateBookingActions] Failed to update booking with calendar event ID:', updateError)
        } else {
          console.log('[privateBookingActions] Successfully updated booking with calendar event ID')
        }
      } else {
        console.warn('[privateBookingActions] No event ID returned from calendar sync')
      }
    } catch (error) {
      console.error('[privateBookingActions] Calendar sync exception:', error)
      // Don't fail the booking creation if calendar sync fails
    }
  } else {
    console.log('[privateBookingActions] Skipping calendar sync:', {
      hasData: !!data,
      isConfigured: isCalendarConfigured()
    })
  }

  revalidatePath('/private-bookings')
  return { success: true, data }
}

// Update private booking
export async function updatePrivateBooking(id: string, formData: FormData) {
  const supabase = await createClient()
  
  // Parse form data
  const rawData = {
    customer_first_name: formData.get('customer_first_name') as string,
    customer_last_name: formData.get('customer_last_name') as string || undefined,
    customer_id: formData.get('customer_id') as string || undefined,
    contact_phone: formData.get('contact_phone') as string || undefined,
    contact_email: formData.get('contact_email') as string || undefined,
    event_date: formData.get('event_date') as string,
    start_time: formatTimeToHHMM(formData.get('start_time') as string) || formData.get('start_time') as string,
    setup_date: formData.get('setup_date') as string || undefined,
    setup_time: formatTimeToHHMM(formData.get('setup_time') as string || undefined),
    end_time: formatTimeToHHMM(formData.get('end_time') as string || undefined),
    guest_count: formData.get('guest_count') ? parseInt(formData.get('guest_count') as string) : undefined,
    event_type: formData.get('event_type') as string || undefined,
    internal_notes: formData.get('internal_notes') as string || undefined,
    customer_requests: formData.get('customer_requests') as string || undefined,
    special_requirements: formData.get('special_requirements') as string || undefined,
    accessibility_needs: formData.get('accessibility_needs') as string || undefined,
    source: formData.get('source') as string || undefined,
    status: formData.get('status') as import('@/types/private-bookings').BookingStatus | undefined,
  }

  // Validate data
  const validationResult = privateBookingSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const bookingData = validationResult.data

  // Get current booking to check status and date changes
  const { data: currentBooking } = await supabase
    .from('private_bookings')
    .select('status, contact_phone, customer_first_name, event_date, start_time, customer_id')
    .eq('id', id)
    .single()

  // Find or create customer if not already linked
  let customerId = bookingData.customer_id
  if (!customerId && bookingData.customer_first_name && bookingData.contact_phone) {
    try {
      const customerData = {
        first_name: bookingData.customer_first_name,
        last_name: bookingData.customer_last_name || '',
        mobile_number: bookingData.contact_phone,
        email: bookingData.contact_email,
        sms_opt_in: true, // Default to true for private bookings
      }
      
      const customer = await findOrCreateCustomer(supabase, customerData)
      customerId = customer.id
      
      console.log('Customer found/created on update:', { 
        id: customer.id, 
        wasLinked: !!currentBooking?.customer_id,
        name: `${customer.first_name} ${customer.last_name}`
      })
    } catch (error) {
      console.error('Error creating/finding customer on update:', error)
      // Continue without linking to customer - maintain backward compatibility
    }
  }

  // Construct customer_name for backward compatibility
  const customer_name = bookingData.customer_last_name 
    ? `${bookingData.customer_first_name} ${bookingData.customer_last_name}`
    : bookingData.customer_first_name

  const { error } = await supabase
    .from('private_bookings')
    .update({
      ...bookingData,
      customer_id: customerId || null, // Include the found/created customer ID
      customer_name, // Include for backward compatibility
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) {
    console.error('Error updating private booking:', error)
    return { error: error.message || 'An error occurred' }
  }

  // Check if event date or time has changed
  const dateChanged = currentBooking && (
    currentBooking.event_date !== bookingData.event_date || 
    currentBooking.start_time !== bookingData.start_time
  )

  if (dateChanged) {
    // Cancel pending SMS messages that reference the old date
    // First get the existing messages to preserve their metadata
    const { data: existingMessages } = await supabase
      .from('private_booking_sms_queue')
      .select('id, metadata')
      .eq('booking_id', id)
      .in('status', ['pending', 'approved'])

    // Update all messages in a single batch operation
    if (existingMessages && existingMessages.length > 0) {
      const messageIds = existingMessages.map(msg => msg.id)
      const commonMetadata = {
        cancelled_reason: 'event_date_changed',
        old_date: currentBooking.event_date,
        new_date: bookingData.event_date,
        old_time: currentBooking.start_time,
        new_time: bookingData.start_time,
        cancelled_at: new Date().toISOString()
      }

      // Build updates with merged metadata for each message
      const updates = existingMessages.map(message => ({
        id: message.id,
        status: 'cancelled',
        metadata: {
          ...(message.metadata || {}),
          ...commonMetadata
        }
      }))

      // Update all messages at once using the IN clause
      const { error: cancelError } = await supabase
        .from('private_booking_sms_queue')
        .upsert(updates, {
          onConflict: 'id',
          ignoreDuplicates: false
        })

      if (cancelError) {
        console.error('Error cancelling SMS messages:', cancelError)
      }
    }

    // Create a notification SMS about the date change if phone number exists
    if (bookingData.contact_phone && currentBooking.status !== 'draft') {
      const oldDate = new Date(currentBooking.event_date)
      const newDate = new Date(bookingData.event_date)
      const oldFormattedDate = oldDate.toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      })
      const newFormattedDate = newDate.toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      })
      
      const smsMessage = `Hi ${bookingData.customer_first_name}, your private booking at The Anchor has been rescheduled from ${oldFormattedDate} at ${currentBooking.start_time} to ${newFormattedDate} at ${bookingData.start_time}. The Anchor 01753 682 707`
      
      await supabase
        .from('private_booking_sms_queue')
        .insert({
          booking_id: id,
          recipient_phone: bookingData.contact_phone,
          message_body: smsMessage,
          trigger_type: 'manual',
          status: 'pending',
          metadata: {
            template: 'date_change_notification',
            old_date: currentBooking.event_date,
            new_date: bookingData.event_date,
            old_time: currentBooking.start_time,
            new_time: bookingData.start_time
          }
        })
    }
  }

  // Queue SMS if status changed to confirmed
  if (currentBooking && bookingData.status === 'confirmed' && currentBooking.status !== 'confirmed' && bookingData.contact_phone) {
    const eventDate = new Date(bookingData.event_date)
    const formattedDate = eventDate.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    
    const smsMessage = `Hi ${bookingData.customer_first_name}, your private booking at The Anchor on ${formattedDate} has been confirmed. We look forward to hosting your event. The Anchor 01753 682 707`
    
    await supabase
      .from('private_booking_sms_queue')
      .insert({
        booking_id: id,
        recipient_phone: bookingData.contact_phone,
        message_body: smsMessage,
        trigger_type: 'status_change',
        status: 'pending',
        metadata: {
          template: 'booking_confirmed',
          status_from: currentBooking.status,
          status_to: 'confirmed'
        }
      })
  }

  // Sync with Google Calendar if configured
  console.log('[privateBookingActions] Checking calendar sync for booking update:', {
    bookingId: id,
    isConfigured: isCalendarConfigured()
  })
  
  if (isCalendarConfigured()) {
    console.log('[privateBookingActions] Fetching updated booking data for calendar sync')
    try {
      // Get the full booking data with the updated fields
      const { data: updatedBooking, error: fetchError } = await supabase
        .from('private_bookings')
        .select('*')
        .eq('id', id)
        .single()
      
      if (fetchError) {
        console.error('[privateBookingActions] Failed to fetch booking for calendar sync:', fetchError)
      } else if (updatedBooking) {
        console.log('[privateBookingActions] Syncing updated booking to calendar:', {
          bookingId: updatedBooking.id,
          hasExistingEventId: !!updatedBooking.calendar_event_id,
          existingEventId: updatedBooking.calendar_event_id
        })
        
        const eventId = await syncCalendarEvent(updatedBooking)
        console.log('[privateBookingActions] Calendar sync result for update:', {
          bookingId: id,
          eventId: eventId,
          hadExistingEventId: !!updatedBooking.calendar_event_id,
          success: !!eventId
        })
        
        if (eventId && !updatedBooking.calendar_event_id) {
          // Update the booking with the calendar event ID if it's new
          console.log('[privateBookingActions] Updating booking with new calendar event ID:', eventId)
          const { error: updateError } = await supabase
            .from('private_bookings')
            .update({ calendar_event_id: eventId })
            .eq('id', id)
          
          if (updateError) {
            console.error('[privateBookingActions] Failed to update booking with calendar event ID:', updateError)
          } else {
            console.log('[privateBookingActions] Successfully updated booking with calendar event ID')
          }
        }
      } else {
        console.warn('[privateBookingActions] No booking data found for calendar sync')
      }
    } catch (error) {
      console.error('[privateBookingActions] Calendar sync exception during update:', error)
      // Don't fail the booking update if calendar sync fails
    }
  } else {
    console.log('[privateBookingActions] Calendar not configured, skipping sync')
  }

  revalidatePath('/private-bookings')
  revalidatePath(`/private-bookings/${id}`)
  return { success: true }
}

// Update booking status
export async function updateBookingStatus(id: string, status: BookingStatus) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('private_bookings')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) {
    console.error('Error updating booking status:', error)
    return { error: error.message || 'An error occurred' }
  }

  // Sync with Google Calendar after status update
  console.log('[privateBookingActions] Status updated, checking calendar sync:', {
    bookingId: id,
    newStatus: status,
    isConfigured: isCalendarConfigured()
  })

  if (isCalendarConfigured()) {
    try {
      // Fetch the full booking details for calendar sync
      const { data: updatedBooking } = await supabase
        .from('private_bookings')
        .select('*')
        .eq('id', id)
        .single()

      if (updatedBooking) {
        console.log('[privateBookingActions] Syncing calendar after status change:', {
          bookingId: id,
          status: updatedBooking.status,
          hasCalendarEventId: !!updatedBooking.calendar_event_id
        })

        const calendarEventId = await syncCalendarEvent(updatedBooking)
        
        if (calendarEventId && !updatedBooking.calendar_event_id) {
          // Update the booking with the new calendar event ID
          await supabase
            .from('private_bookings')
            .update({ calendar_event_id: calendarEventId })
            .eq('id', id)
        }
        
        console.log('[privateBookingActions] Calendar sync completed after status change:', {
          bookingId: id,
          calendarEventId,
          statusInCalendar: status
        })
      }
    } catch (error) {
      console.error('[privateBookingActions] Calendar sync exception during status update:', error)
      // Don't fail the status update if calendar sync fails
    }
  } else {
    console.log('[privateBookingActions] Calendar not configured, skipping sync')
  }

  revalidatePath('/private-bookings')
  revalidatePath(`/private-bookings/${id}`)
  return { success: true }
}

// Delete private booking
export async function deletePrivateBooking(id: string) {
  const supabase = await createClient()
  
  // Get the booking first to check status and calendar event
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('status, calendar_event_id')
    .eq('id', id)
    .single()
  
  if (fetchError || !booking) {
    console.error('Error fetching booking for deletion:', fetchError)
    return { error: 'Booking not found' }
  }
  
  // Check if booking status allows deletion
  const allowedStatuses = ['draft', 'cancelled']
  if (!allowedStatuses.includes(booking.status)) {
    return { 
      error: `Only draft or cancelled bookings can be deleted. This booking is ${booking.status}. Please cancel it first if you need to delete it.`
    }
  }
  
  const { error } = await supabase
    .from('private_bookings')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting private booking:', error)
    return { error: error.message || 'An error occurred' }
  }

  // Delete from Google Calendar if configured and event exists
  console.log('[privateBookingActions] Checking calendar deletion:', {
    bookingId: id,
    hasCalendarEventId: !!booking?.calendar_event_id,
    calendarEventId: booking?.calendar_event_id,
    isConfigured: isCalendarConfigured()
  })
  
  if (booking?.calendar_event_id && isCalendarConfigured()) {
    console.log('[privateBookingActions] Deleting calendar event:', booking.calendar_event_id)
    try {
      const deleteResult = await deleteCalendarEvent(booking.calendar_event_id)
      console.log('[privateBookingActions] Calendar deletion result:', {
        eventId: booking.calendar_event_id,
        success: deleteResult
      })
    } catch (error) {
      console.error('[privateBookingActions] Calendar deletion exception:', error)
      // Don't fail the deletion if calendar sync fails
    }
  } else {
    console.log('[privateBookingActions] Skipping calendar deletion:', {
      hasEventId: !!booking?.calendar_event_id,
      isConfigured: isCalendarConfigured()
    })
  }

  revalidatePath('/private-bookings')
  revalidatePath(`/private-bookings/${id}`)
  return { success: true }
}

// Get venue spaces
export async function getVenueSpaces(activeOnly = true) {
  const supabase = await createClient()
  
  let query = supabase
    .from('venue_spaces')
    .select('*')
    .order('display_order', { ascending: true })

  if (activeOnly) {
    query = query.eq('active', true)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching venue spaces:', error)
    return { error: error.message || 'An error occurred' }
  }

  return { data }
}

// Get catering packages
export async function getCateringPackages(activeOnly = true) {
  const supabase = await createClient()
  
  let query = supabase
    .from('catering_packages')
    .select('*')
    .order('display_order', { ascending: true })

  if (activeOnly) {
    query = query.eq('active', true)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching catering packages:', error)
    return { error: error.message || 'An error occurred' }
  }

  return { data }
}

// Get vendors
export async function getVendors(serviceType?: string, activeOnly = true) {
  const supabase = await createClient()
  
  let query = supabase
    .from('vendors')
    .select('*')
    .order('preferred', { ascending: false })
    .order('name', { ascending: true })

  if (activeOnly) {
    query = query.eq('active', true)
  }

  if (serviceType) {
    query = query.eq('service_type', serviceType)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching vendors:', error)
    return { error: error.message || 'An error occurred' }
  }

  return { data }
}

// Record deposit payment
export async function recordDepositPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()
  
  const paymentMethod = formData.get('payment_method') as string
  const amount = parseFloat(formData.get('amount') as string)
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  // First, get the booking details for SMS
  const { data: booking } = await supabase
    .from('private_bookings')
    .select('customer_first_name, customer_last_name, customer_name, event_date, contact_phone')
    .eq('id', bookingId)
    .single()
  
  const { error } = await supabase
    .from('private_bookings')
    .update({
      deposit_paid_date: new Date().toISOString(),
      deposit_payment_method: paymentMethod,
      deposit_amount: amount,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)

  if (error) {
    console.error('Error recording deposit payment:', error)
    return { error: error.message || 'An error occurred' }
  }
  
  // Queue and auto-send SMS for deposit received
  if (booking && booking.contact_phone) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    
    const smsMessage = `Hi ${booking.customer_first_name}, we've received your deposit of £${amount}. Your private booking on ${eventDate} is now secured. Reply to this message with any questions.`
    
    const smsResult = await queueAndSendPrivateBookingSms({
      booking_id: bookingId,
      trigger_type: 'deposit_received',
      template_key: 'private_booking_deposit_received',
      message_body: smsMessage,
      customer_phone: booking.contact_phone,
      customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
      created_by: user?.id,
      priority: 1, // High priority for payment confirmations
      metadata: {
        template: 'private_booking_deposit_received',
        first_name: booking.customer_first_name,
        amount: amount,
        event_date: eventDate
      }
    })
    
    if (smsResult.error) {
      console.error('Error sending deposit SMS:', smsResult.error)
    } else if (smsResult.sent) {
      console.log('Deposit payment SMS sent successfully')
    }
  }

  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

// Record final payment
export async function recordFinalPayment(bookingId: string, formData: FormData) {
  const supabase = await createClient()
  
  const paymentMethod = formData.get('payment_method') as string
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  // First, get the booking details for SMS
  const { data: booking } = await supabase
    .from('private_bookings')
    .select('customer_first_name, customer_last_name, customer_name, event_date, contact_phone')
    .eq('id', bookingId)
    .single()
  
  const { error } = await supabase
    .from('private_bookings')
    .update({
      final_payment_date: new Date().toISOString(),
      final_payment_method: paymentMethod,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)

  if (error) {
    console.error('Error recording final payment:', error)
    return { error: error.message || 'An error occurred' }
  }
  
  // Queue and auto-send SMS for final payment received
  if (booking && booking.contact_phone) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
    
    const smsMessage = `Hi ${booking.customer_first_name}, thank you for your final payment. Your private booking on ${eventDate} is fully paid. Reply to this message with any questions.`
    
    const smsResult = await queueAndSendPrivateBookingSms({
      booking_id: bookingId,
      trigger_type: 'final_payment_received',
      template_key: 'private_booking_final_payment',
      message_body: smsMessage,
      customer_phone: booking.contact_phone,
      customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
      created_by: user?.id,
      priority: 1, // High priority for payment confirmations
      metadata: {
        template: 'private_booking_final_payment',
        first_name: booking.customer_first_name,
        event_date: eventDate
      }
    })
    
    if (smsResult.error) {
      console.error('Error sending final payment SMS:', smsResult.error)
    } else if (smsResult.sent) {
      console.log('Final payment SMS sent successfully')
    }
  }

  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

// Cancel a private booking and notify customer by SMS
export async function cancelPrivateBooking(bookingId: string, reason?: string) {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch booking details needed for SMS and to check status
  const { data: booking, error: fetchError } = await supabase
    .from('private_bookings')
    .select('id, status, event_date, customer_first_name, customer_last_name, customer_name, contact_phone')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return { error: 'Booking not found' }
  }

  if (booking.status === 'cancelled' || booking.status === 'completed') {
    return { error: 'Booking cannot be cancelled' }
  }

  // Update status to cancelled (with graceful fallback if legacy schema lacks columns)
  const nowIso = new Date().toISOString()
  let { error: updateError } = await supabase
    .from('private_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: reason || 'Cancelled by staff',
      cancelled_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', bookingId)

  // Fallback: some environments may not yet have cancellation_reason/cancelled_at
  if (updateError && (updateError.code === 'PGRST204' || (updateError.message || '').includes('cancellation_reason') || (updateError.message || '').includes('cancelled_at'))) {
    console.warn('Private bookings schema missing cancellation columns; applying fallback update without those fields')
    const fallback = await supabase
      .from('private_bookings')
      .update({
        status: 'cancelled',
        updated_at: nowIso
      })
      .eq('id', bookingId)
    updateError = fallback.error || null
  }

  if (updateError) {
    console.error('Error cancelling private booking:', updateError)
    return { error: 'Failed to cancel booking' }
  }

  // Send SMS to customer if phone exists
  if (booking.contact_phone) {
    const eventDate = new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    })

    const firstName = booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there'
    const smsMessage = `Hi ${firstName}, your tentative private booking date on ${eventDate} has been cancelled. If you believe this was a mistake, please contact us.`

    const smsResult = await queueAndSendPrivateBookingSms({
      booking_id: bookingId,
      trigger_type: 'booking_cancelled',
      template_key: 'private_booking_cancelled',
      message_body: smsMessage,
      customer_phone: booking.contact_phone,
      customer_name: booking.customer_name || `${booking.customer_first_name} ${booking.customer_last_name || ''}`.trim(),
      created_by: user?.id,
      priority: 2,
      metadata: {
        template: 'private_booking_cancelled',
        event_date: eventDate,
        reason: reason || 'staff_cancelled'
      }
    })

    if (smsResult && 'error' in smsResult && smsResult.error) {
      console.error('Failed to send cancellation SMS:', smsResult.error)
    }
  }

  revalidatePath('/private-bookings')
  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

// Apply booking-level discount
export async function applyBookingDiscount(bookingId: string, data: {
  discount_type: 'percent' | 'fixed'
  discount_amount: number
  discount_reason: string
}) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('private_bookings')
    .update({
      discount_type: data.discount_type,
      discount_amount: data.discount_amount,
      discount_reason: data.discount_reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)

  if (error) {
    console.error('Error applying disbadge: ', error)
    return { error: error.message || 'Failed to apply discount' }
  }

  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}

// SMS Queue Management
export async function approveSms(smsId: string) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await supabase
    .from('private_booking_sms_queue')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: user.id
    })
    .eq('id', smsId)
    .eq('status', 'pending')
  
  if (error) {
    console.error('Error approving SMS:', error)
    return { error: error.message || 'Failed to approve SMS' }
  }
  
  revalidatePath('/private-bookings/sms-queue')
  return { success: true }
}

export async function rejectSms(smsId: string) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await supabase
    .from('private_booking_sms_queue')
    .update({
      status: 'cancelled',
      approved_at: new Date().toISOString(),
      approved_by: user.id
    })
    .eq('id', smsId)
    .eq('status', 'pending')
  
  if (error) {
    console.error('Error rejecting SMS:', error)
    return { error: error.message || 'Failed to reject SMS' }
  }
  
  revalidatePath('/private-bookings/sms-queue')
  return { success: true }
}

export async function sendApprovedSms(smsId: string) {
  const supabase = await createClient()
  const admin = createAdminClient()
  
  // Get the SMS details
  const { data: sms, error: fetchError } = await supabase
    .from('private_booking_sms_queue')
    .select('*')
    .eq('id', smsId)
    .eq('status', 'approved')
    .single()
  
  if (fetchError || !sms) {
    console.error('Error fetching SMS:', fetchError)
    return { error: 'SMS not found or not approved' }
  }
  
  // Import the SMS sending function
  const { sendSms } = await import('@/app/actions/sms')
  
  // Send the SMS
  const result = await sendSms({
    to: sms.recipient_phone,
    body: sms.message_body,
    bookingId: sms.booking_id
  })
  
  if (result.error) {
    // Update status to failed
    await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'failed',
        sent_at: new Date().toISOString(),
        error_message: result.error
      })
      .eq('id', smsId)
    
    return { error: result.error }
  }
  
  // Link the message row to the customer_id for customer page visibility
  try {
    const { data: booking } = await admin
      .from('private_bookings')
      .select('customer_id')
      .eq('id', sms.booking_id)
      .single()
    if (booking?.customer_id) {
      await admin
        .from('messages')
        .update({ customer_id: booking.customer_id })
        .eq('twilio_message_sid', result.sid as string)
    }
  } catch (linkErr) {
    console.warn('[sendApprovedSms] Could not link message to customer_id:', linkErr)
  }

  // Update status to sent
  await supabase
    .from('private_booking_sms_queue')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      twilio_message_sid: result.sid as string
    })
    .eq('id', smsId)
  
  revalidatePath('/private-bookings/sms-queue')
  return { success: true }
}

// Venue Space Management
export async function createVenueSpace(data: {
  name: string
  capacity: number
  hire_cost: number
  description?: string | null
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    capacity_seated: data.capacity,
    rate_per_hour: data.hire_cost,
    description: data.description,
    active: data.is_active,
    minimum_hours: 1, // Default value
    setup_fee: 0, // Default value
    display_order: 0 // Default value
  }
  
  const { error } = await supabase
    .from('venue_spaces')
    .insert(dbData)
  
  if (error) {
    console.error('Error creating venue space:', error)
    return { error: error.message || 'Failed to create venue space' }
  }
  
  revalidatePath('/private-bookings/settings/spaces')
  return { success: true }
}

export async function updateVenueSpace(id: string, data: {
  name: string
  capacity: number
  hire_cost: number
  description?: string | null
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    capacity_seated: data.capacity,
    rate_per_hour: data.hire_cost,
    description: data.description,
    active: data.is_active
  }
  
  const { error } = await supabase
    .from('venue_spaces')
    .update(dbData)
    .eq('id', id)
  
  if (error) {
    console.error('Error updating venue space:', error)
    return { error: error.message || 'Failed to update venue space' }
  }
  
  revalidatePath('/private-bookings/settings/spaces')
  return { success: true }
}

export async function deleteVenueSpace(id: string) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('venue_spaces')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Error deleting venue space:', error)
    return { error: error.message || 'Failed to delete venue space' }
  }
  
  revalidatePath('/private-bookings/settings/spaces')
  return { success: true }
}

// Catering Package Management
export async function createCateringPackage(data: {
  name: string
  package_type: string
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  description?: string | null
  includes?: string | null
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    package_type: data.package_type,
    cost_per_head: data.per_head_cost,
    pricing_model: data.pricing_model || 'per_head',
    minimum_guests: data.minimum_order,
    description: data.description,
    dietary_notes: data.includes,
    active: data.is_active,
    display_order: 0 // Default value
  }
  
  const { error } = await supabase
    .from('catering_packages')
    .insert(dbData)
  
  if (error) {
    console.error('Error creating catering package:', error)
    return { error: error.message || 'Failed to create catering package' }
  }
  
  revalidatePath('/private-bookings/settings/catering')
  return { success: true }
}

export async function updateCateringPackage(id: string, data: {
  name: string
  package_type: string
  per_head_cost: number
  pricing_model?: 'per_head' | 'total_value'
  minimum_order?: number | null
  description?: string | null
  includes?: string | null
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    package_type: data.package_type,
    cost_per_head: data.per_head_cost,
    pricing_model: data.pricing_model || 'per_head',
    minimum_guests: data.minimum_order,
    description: data.description,
    dietary_notes: data.includes,
    active: data.is_active
  }
  
  const { error } = await supabase
    .from('catering_packages')
    .update(dbData)
    .eq('id', id)
  
  if (error) {
    console.error('Error updating catering package:', error)
    return { error: error.message || 'Failed to update catering package' }
  }
  
  revalidatePath('/private-bookings/settings/catering')
  return { success: true }
}

export async function deleteCateringPackage(id: string) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('catering_packages')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Error deleting catering package:', error)
    return { error: error.message || 'Failed to delete catering package' }
  }
  
  revalidatePath('/private-bookings/settings/catering')
  return { success: true }
}

// Booking Items Management
export async function getBookingItems(bookingId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('private_booking_items')
    .select(`
      *,
      space:venue_spaces(*),
      package:catering_packages(*),
      vendor:vendors(*)
    `)
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching booking items:', error)
    return { error: error.message || 'Failed to fetch booking items' }
  }

  return { data }
}

export async function addBookingItem(data: {
  booking_id: string
  item_type: 'space' | 'catering' | 'vendor' | 'other'
  space_id?: string | null
  package_id?: string | null
  vendor_id?: string | null
  description: string
  quantity: number
  unit_price: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  notes?: string | null
}) {
  const supabase = await createClient()
  
  // Don't include line_total as it's a generated column
  const { error } = await supabase
    .from('private_booking_items')
    .insert({
      booking_id: data.booking_id,
      item_type: data.item_type,
      space_id: data.space_id,
      package_id: data.package_id,
      vendor_id: data.vendor_id,
      description: data.description,
      quantity: data.quantity,
      unit_price: data.unit_price,
      discount_value: data.discount_value,
      discount_type: data.discount_type,
      notes: data.notes
    })
  
  if (error) {
    console.error('Error adding booking item:', error)
    return { error: error.message || 'Failed to add booking item' }
  }
  
  revalidatePath(`/private-bookings/${data.booking_id}`)
  revalidatePath(`/private-bookings/${data.booking_id}/items`)
  return { success: true }
}

export async function updateBookingItem(itemId: string, data: {
  quantity?: number
  unit_price?: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  notes?: string | null
}) {
  const supabase = await createClient()
  
  // Get current item to find booking ID for revalidation
  const { data: currentItem, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('booking_id')
    .eq('id', itemId)
    .single()
  
  if (fetchError || !currentItem) {
    return { error: 'Item not found' }
  }
  
  // Build update object - only include fields that are provided
  const updateData: any = {}
  
  if (data.quantity !== undefined) updateData.quantity = data.quantity
  if (data.unit_price !== undefined) updateData.unit_price = data.unit_price
  if (data.discount_value !== undefined) updateData.discount_value = data.discount_value
  if (data.discount_type !== undefined) updateData.discount_type = data.discount_type
  if (data.notes !== undefined) updateData.notes = data.notes
  
  // Don't include line_total as it's a generated column
  const { error } = await supabase
    .from('private_booking_items')
    .update(updateData)
    .eq('id', itemId)
  
  if (error) {
    console.error('Error updating booking item:', error)
    return { error: error.message || 'Failed to update booking item' }
  }
  
  // Revalidate the booking pages
  const bookingId = currentItem.booking_id
  revalidatePath(`/private-bookings/${bookingId}`)
  revalidatePath(`/private-bookings/${bookingId}/items`)
  return { success: true }
}

export async function deleteBookingItem(itemId: string) {
  const supabase = await createClient()
  
  // Get booking ID before deleting
  const { data: item, error: fetchError } = await supabase
    .from('private_booking_items')
    .select('booking_id')
    .eq('id', itemId)
    .single()
  
  if (fetchError || !item) {
    return { error: 'Item not found' }
  }
  
  const { error } = await supabase
    .from('private_booking_items')
    .delete()
    .eq('id', itemId)
  
  if (error) {
    console.error('Error deleting booking item:', error)
    return { error: error.message || 'Failed to delete booking item' }
  }
  
  revalidatePath(`/private-bookings/${item.booking_id}`)
  revalidatePath(`/private-bookings/${item.booking_id}/items`)
  return { success: true }
}

// Vendor Management
export async function createVendor(data: {
  name: string
  vendor_type: string
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  typical_rate?: number | null
  notes?: string | null
  is_preferred: boolean
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    service_type: data.vendor_type,
    contact_name: data.contact_name,
    contact_phone: data.phone,
    email: data.email,
    website: data.website,
    typical_rate: data.typical_rate,
    notes: data.notes,
    preferred: data.is_preferred,
    active: data.is_active
  }
  
  const { error } = await supabase
    .from('vendors')
    .insert(dbData)
  
  if (error) {
    console.error('Error creating vendor:', error)
    return { error: error.message || 'Failed to create vendor' }
  }
  
  revalidatePath('/private-bookings/settings/vendors')
  return { success: true }
}

export async function updateVendor(id: string, data: {
  name: string
  vendor_type: string
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  typical_rate?: number | null
  notes?: string | null
  is_preferred: boolean
  is_active: boolean
}) {
  const supabase = await createClient()
  
  // Map to correct database columns
  const dbData = {
    name: data.name,
    service_type: data.vendor_type,
    contact_name: data.contact_name,
    contact_phone: data.phone,
    email: data.email,
    website: data.website,
    typical_rate: data.typical_rate,
    notes: data.notes,
    preferred: data.is_preferred,
    active: data.is_active
  }
  
  const { error } = await supabase
    .from('vendors')
    .update(dbData)
    .eq('id', id)
  
  if (error) {
    console.error('Error updating vendor:', error)
    return { error: error.message || 'Failed to update vendor' }
  }
  
  revalidatePath('/private-bookings/settings/vendors')
  return { success: true }
}

export async function deleteVendor(id: string) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('vendors')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Error deleting vendor:', error)
    return { error: error.message || 'Failed to delete vendor' }
  }
  
  revalidatePath('/private-bookings/settings/vendors')
  return { success: true }
}
