'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { queueBookingConfirmationSMS, queueCancellationSMS, queuePaymentRequestSMS } from './table-booking-sms';
import { sendBookingConfirmationEmail, sendBookingCancellationEmail } from './table-booking-email';
import { sendSameDayBookingAlertIfNeeded, TableBookingNotificationRecord } from '@/lib/table-bookings/managerNotifications';

// Helper function to format time from 24hr to 12hr format
function formatTime12Hour(time24: string): string {
  const timeWithoutSeconds = time24.split(':').slice(0, 2).join(':');
  const [hours, minutes] = timeWithoutSeconds.split(':').map(Number);
  
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  
  if (minutes === 0) {
    return `${hours12}${period}`;
  } else {
    return `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
  }
}

// Validation schemas
const CreateTableBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/),
  party_size: z.number().min(1).max(20),
  booking_type: z.enum(['regular', 'sunday_lunch']),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  duration_minutes: z.number().default(120),
  source: z.string().default('phone'),
});

const CreateCustomerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  mobile_number: z.string().min(10),
  email: z.string().email().optional(),
  sms_opt_in: z.boolean().default(true),
});

const UpdateTableBookingSchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  party_size: z.number().min(1).max(20).optional(),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  tables_assigned: z.any().optional(),
  internal_notes: z.string().optional(),
});

// Helper function to find or create customer
async function findOrCreateCustomer(
  supabase: ReturnType<typeof createAdminClient>,
  customerData: z.infer<typeof CreateCustomerSchema>
) {
  const standardizedPhone = formatPhoneForStorage(customerData.mobile_number);
  const phoneVariants = generatePhoneVariants(standardizedPhone);

  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
    .single();

  if (existingCustomer) {
    const updates: Record<string, unknown> = {};

    if (customerData.sms_opt_in !== existingCustomer.sms_opt_in) {
      updates.sms_opt_in = customerData.sms_opt_in;
    }

    if (existingCustomer.mobile_number !== standardizedPhone) {
      updates.mobile_number = standardizedPhone;
    }

    if (!existingCustomer.mobile_e164 || existingCustomer.mobile_e164 !== standardizedPhone) {
      updates.mobile_e164 = standardizedPhone;
    }

    if (customerData.email && customerData.email !== existingCustomer.email) {
      updates.email = customerData.email;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('customers')
        .update(updates)
        .eq('id', existingCustomer.id);

      return { ...existingCustomer, ...updates } as typeof existingCustomer;
    }

    return existingCustomer;
  }

  const insertPayload: Record<string, unknown> = {
    first_name: customerData.first_name,
    last_name: customerData.last_name,
    mobile_number: standardizedPhone,
    mobile_e164: standardizedPhone,
    sms_opt_in: customerData.sms_opt_in,
  };

  if (customerData.email) {
    insertPayload.email = customerData.email;
  }

  const { data: newCustomer, error } = await supabase
    .from('customers')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error('Failed to create customer from table booking:', error);
    throw new Error('Failed to create customer');
  }

  return newCustomer;
}

// Check table availability - now uses fixed capacity system
export async function checkTableAvailability(
  date: string,
  time: string,
  partySize: number,
  excludeBookingId?: string
) {
  try {
    const supabase = await createClient();
    
    // Call the updated database function that uses fixed capacity
    const { data, error } = await supabase.rpc('check_table_availability', {
      p_date: date,
      p_time: time,
      p_party_size: partySize,
      p_duration_minutes: 120,
      p_exclude_booking_id: excludeBookingId || null,
    });
    
    if (error) {
      console.error('Availability check error:', error);
      return { error: 'Failed to check availability' };
    }
    
    return { 
      data: {
        available_capacity: data[0]?.available_capacity || 0,
        is_available: data[0]?.is_available || false,
      }
    };
  } catch (error) {
    console.error('Availability check error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Create table booking
export async function createTableBooking(formData: FormData) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'create');
    if (!hasPermission) {
      return { error: 'You do not have permission to create bookings' };
    }
    
    // Parse and validate booking data
    const bookingData = CreateTableBookingSchema.parse({
      customer_id: formData.get('customer_id') || undefined,
      booking_date: formData.get('booking_date'),
      booking_time: formData.get('booking_time'),
      party_size: parseInt(formData.get('party_size') as string),
      booking_type: formData.get('booking_type'),
      special_requirements: formData.get('special_requirements') || undefined,
      dietary_requirements: formData.get('dietary_requirements') 
        ? JSON.parse(formData.get('dietary_requirements') as string) 
        : undefined,
      allergies: formData.get('allergies')
        ? JSON.parse(formData.get('allergies') as string)
        : undefined,
      celebration_type: formData.get('celebration_type') || undefined,
      duration_minutes: parseInt(formData.get('duration_minutes') as string) || 120,
      source: formData.get('source') || 'phone',
    });
    
    // If no customer_id, try to find or create customer
    let customerId = bookingData.customer_id;
    if (!customerId && formData.get('customer_first_name')) {
      const customerData = CreateCustomerSchema.parse({
        first_name: formData.get('customer_first_name'),
        last_name: formData.get('customer_last_name'),
        mobile_number: formData.get('customer_mobile_number'),
        email: formData.get('customer_email') || undefined,
        sms_opt_in: formData.get('customer_sms_opt_in') === 'true',
      });
      
      const customer = await findOrCreateCustomer(adminSupabase, customerData);
      customerId = customer.id;
    }
    
    if (!customerId) {
      return { error: 'Customer information is required' };
    }
    
    // Check availability
    const availability = await checkTableAvailability(
      bookingData.booking_date,
      bookingData.booking_time,
      bookingData.party_size
    );
    
    if (availability.error || !availability.data?.is_available) {
      return { error: 'No tables available for the selected time' };
    }
    
    // Validate booking against policy
    const { data: policyCheck, error: policyError } = await supabase.rpc(
      'validate_booking_against_policy',
      {
        p_booking_type: bookingData.booking_type,
        p_booking_date: bookingData.booking_date,
        p_booking_time: bookingData.booking_time,
        p_party_size: bookingData.party_size,
      }
    );
    
    if (policyError || !policyCheck?.[0]?.is_valid) {
      return { error: policyCheck?.[0]?.error_message || 'Booking does not meet policy requirements' };
    }
    
    // Validate that the booking time is within kitchen hours
    const bookingDay = new Date(bookingData.booking_date).getDay();
    
    // Get business hours for the booking day
    const { data: businessHours } = await supabase
      .from('business_hours')
      .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
      .eq('day_of_week', bookingDay)
      .single();
      
    // Check for special hours
    const { data: specialHours } = await supabase
      .from('special_hours')
      .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
      .eq('date', bookingData.booking_date)
      .single();
      
    const activeHours = specialHours || businessHours;
    
    // Check if kitchen is closed
    const kitchenClosed = !activeHours || 
                         activeHours.is_closed || 
                         activeHours.is_kitchen_closed ||
                         (!activeHours.kitchen_opens || !activeHours.kitchen_closes);
    
    if (kitchenClosed) {
      return { error: 'Kitchen is closed on the selected date' };
    }
    
    // Check if booking time is within kitchen hours
    const bookingTime = bookingData.booking_time;
    const kitchenOpens = activeHours.kitchen_opens;
    const kitchenCloses = activeHours.kitchen_closes;
    
    if (bookingTime < kitchenOpens || bookingTime >= kitchenCloses) {
      return { error: `Kitchen is only open from ${formatTime12Hour(kitchenOpens)} to ${formatTime12Hour(kitchenCloses)} on this day` };
    }
    
    // Create booking
    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .insert({
        customer_id: customerId,
        booking_date: bookingData.booking_date,
        booking_time: bookingData.booking_time,
        party_size: bookingData.party_size,
        booking_type: bookingData.booking_type,
        special_requirements: bookingData.special_requirements,
        dietary_requirements: bookingData.dietary_requirements,
        allergies: bookingData.allergies,
        celebration_type: bookingData.celebration_type,
        duration_minutes: bookingData.duration_minutes,
        source: bookingData.source,
        status: bookingData.booking_type === 'sunday_lunch' ? 'pending_payment' : 'confirmed',
      })
      .select('*, customer:customers(first_name, last_name, mobile_number, email)')
      .single();
      
    if (bookingError) {
      console.error('Booking creation error:', bookingError);
      return { error: 'Failed to create booking' };
    }
    
    // If menu items provided (for Sunday lunch), create them
    const menuItemsData = formData.get('menu_items');
    if (menuItemsData && booking.booking_type === 'sunday_lunch') {
      try {
        const menuItems = JSON.parse(menuItemsData as string);
        
        // Insert booking items
        const { error: itemsError } = await supabase
          .from('table_booking_items')
          .insert(
            menuItems.map((item: any) => ({
              booking_id: booking.id,
              custom_item_name: item.custom_item_name,
              item_type: item.item_type,
              quantity: item.quantity,
              guest_name: item.guest_name,
              price_at_booking: item.price_at_booking,
              special_requests: item.special_requests,
            }))
          );
          
        if (itemsError) {
          console.error('Menu items creation error:', itemsError);
          // Don't fail the whole booking, but log the issue
        }
      } catch (err) {
        console.error('Menu items parsing error:', err);
      }
    }

    await sendSameDayBookingAlertIfNeeded(booking as TableBookingNotificationRecord);

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        booking_type: booking.booking_type,
        party_size: booking.party_size,
        booking_date: booking.booking_date,
        source: booking.source,
      }
    });
    
    // Send confirmation SMS if booking is confirmed (not pending payment)
    if (booking.status === 'confirmed') {
      console.log(`Booking confirmed, attempting to queue SMS for booking ${booking.id}`);
      
      // Send SMS immediately for booking confirmations
      try {
        // Get customer details (we already have them from the booking creation)
        const { data: customerData } = await adminSupabase
          .from('customers')
          .select('*')
          .eq('id', customerId)
          .single();
        
        if (customerData?.sms_opt_in && customerData?.mobile_number) {
          // Get the appropriate template
          const templateKey = bookingData.booking_type === 'sunday_lunch'
            ? 'booking_confirmation_sunday_lunch'
            : 'booking_confirmation_regular';
          
          const { data: template } = await supabase
            .from('table_booking_sms_templates')
            .select('*')
            .eq('template_key', templateKey)
            .eq('is_active', true)
            .single();
          
          if (template) {
            // Prepare variables
            const variables: Record<string, string> = {
              customer_name: customerData.first_name,
              party_size: booking.party_size.toString(),
              date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              }),
              time: formatTime12Hour(booking.booking_time),
              reference: booking.booking_reference,
              contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
            };
            
            // Build the message text from template
            let messageText = template.template_text;
            Object.entries(variables).forEach(([key, value]) => {
              messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), value);
            });
            
            // Send SMS immediately
            const { sendSMS } = await import('@/lib/twilio');
            const result = await sendSMS(customerData.mobile_number, messageText);
            
            if (result.success && result.sid) {
              console.log('SMS sent immediately for booking:', booking.id);
              
              // Log the message in the database
              await supabase
                .from('messages')
                .insert({
                  customer_id: customerData.id,
                  direction: 'outbound',
                  message_sid: result.sid,
                  twilio_message_sid: result.sid,
                  body: messageText,
                  status: 'sent',
                  twilio_status: 'queued',
                  from_number: process.env.TWILIO_PHONE_NUMBER,
                  to_number: customerData.mobile_number,
                  message_type: 'sms',
                  metadata: { booking_id: booking.id, template_key: templateKey }
                });
            } else {
              console.error('Failed to send SMS immediately:', result.error);
              // Fall back to queuing the SMS if immediate send fails
              await supabase
                .from('jobs')
                .insert({
                  type: 'send_sms',
                  payload: {
                    to: customerData.mobile_number,
                    template: templateKey,
                    variables,
                    booking_id: booking.id,
                    customer_id: customerData.id,
                  },
                  scheduled_for: new Date().toISOString(),
                });
            }
          } else {
            console.error('SMS template not found:', templateKey);
          }
        } else {
          console.log('Customer has opted out of SMS or has no phone number');
        }
      } catch (smsError) {
        console.error('Error sending SMS:', smsError);
      }
      
      // Also send email confirmation
      const emailResult = await sendBookingConfirmationEmail(booking.id);
      if (emailResult.error) {
        console.error('Send email error:', emailResult.error);
      }
    } else if (booking.status === 'pending_payment' && booking.booking_type === 'sunday_lunch') {
      // For Sunday lunch, send payment request SMS immediately
      console.log(`Sunday lunch booking created, sending payment request SMS for booking ${booking.id}`);
      
      try {
        // Get customer details
        const { data: customerData } = await supabase
          .from('customers')
          .select('*')
          .eq('id', customerId)
          .single();
        
        if (customerData?.sms_opt_in && customerData?.mobile_number) {
          // Calculate payment deadline (Saturday 1pm before the Sunday booking)
          const bookingDate = new Date(booking.booking_date);
          const deadlineDate = new Date(bookingDate);
          deadlineDate.setDate(bookingDate.getDate() - 1); // Saturday before
          deadlineDate.setHours(13, 0, 0, 0); // 1pm
          
          const deadlineFormatted = deadlineDate.toLocaleDateString('en-GB', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          });
          
          // Calculate deposit amount
          const depositAmount = booking.party_size * 5;
          
          // Generate payment URL with link shortening
          const longPaymentUrl = `/table-booking/${booking.booking_reference}/payment`;
          const { createShortLinkInternal } = await import('@/app/actions/short-links');
          const shortLinkResult = await createShortLinkInternal({
            destination_url: `${process.env.NEXT_PUBLIC_APP_URL}${longPaymentUrl}`,
            link_type: 'custom',
            metadata: { 
              booking_id: booking.id,
              booking_reference: booking.booking_reference,
              type: 'sunday_lunch_payment'
            },
            expires_at: deadlineDate.toISOString()
          });
          
          const paymentUrl = shortLinkResult.success 
            ? shortLinkResult.data.full_url 
            : `${process.env.NEXT_PUBLIC_APP_URL}${longPaymentUrl}`;
          
          // Build message with dynamic deadline and urgency
          const messageText = `Hi ${customerData.first_name}, your Sunday Lunch booking at The Anchor (ref: ${booking.booking_reference}) for ${booking.party_size} people requires a £${depositAmount.toFixed(2)} deposit to confirm. ⚠️ PAYMENT DEADLINE: ${deadlineFormatted}. Pay now: ${paymentUrl}. If payment is not received by the deadline, your booking will be automatically cancelled. Call ${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'} with any questions.`;
          
          // Send SMS immediately
          const { sendSMS } = await import('@/lib/twilio');
          const result = await sendSMS(customerData.mobile_number, messageText);
          
          if (result.success && result.sid) {
            console.log('Payment request SMS sent immediately for booking:', booking.id);
            
            // Log the message in the database
            await supabase
              .from('messages')
              .insert({
                customer_id: customerData.id,
                direction: 'outbound',
                message_sid: result.sid,
                twilio_message_sid: result.sid,
                body: messageText,
                status: 'sent',
                twilio_status: 'queued',
                from_number: process.env.TWILIO_PHONE_NUMBER,
                to_number: customerData.mobile_number,
                message_type: 'sms',
                metadata: { 
                  booking_id: booking.id, 
                  template_key: 'payment_request',
                  deadline: deadlineFormatted,
                  deposit_amount: depositAmount
                }
              });
          } else {
            console.error('Failed to send payment request SMS immediately:', result.error);
            // Fall back to queueing the SMS if immediate send fails
            const smsResult = await queuePaymentRequestSMS(booking.id);
            if (smsResult.error) {
              console.error('Queue SMS error:', smsResult.error);
            }
          }
        } else {
          console.log('Customer has opted out of SMS or has no phone number');
        }
      } catch (smsError) {
        console.error('Error sending payment request SMS:', smsError);
        // Try to queue as fallback
        const smsResult = await queuePaymentRequestSMS(booking.id);
        if (smsResult.error) {
          console.error('Queue SMS fallback error:', smsResult.error);
        }
      }
    }
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath('/table-bookings/calendar');
    
    return { success: true, data: booking };
  } catch (error) {
    console.error('Create booking error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Update table booking
export async function updateTableBooking(
  bookingId: string,
  updates: z.infer<typeof UpdateTableBookingSchema>
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to edit bookings' };
    }
    
    // Get current booking
    const { data: currentBooking, error: fetchError } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('id', bookingId)
      .single();
      
    if (fetchError || !currentBooking) {
      return { error: 'Booking not found' };
    }
    
    // If date/time/size changed, check availability
    if (updates.booking_date || updates.booking_time || updates.party_size) {
      const availability = await checkTableAvailability(
        updates.booking_date || currentBooking.booking_date,
        updates.booking_time || currentBooking.booking_time,
        updates.party_size || currentBooking.party_size,
        bookingId
      );
      
      if (availability.error || !availability.data?.is_available) {
        return { error: 'No tables available for the updated time' };
      }
      
      // Also validate kitchen hours if date or time changed
      if (updates.booking_date || updates.booking_time) {
        const newDate = updates.booking_date || currentBooking.booking_date;
        const newTime = updates.booking_time || currentBooking.booking_time;
        const bookingDay = new Date(newDate).getDay();
        
        // Get business hours for the booking day
        const { data: businessHours } = await supabase
          .from('business_hours')
          .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
          .eq('day_of_week', bookingDay)
          .single();
          
        // Check for special hours
        const { data: specialHours } = await supabase
          .from('special_hours')
          .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
          .eq('date', newDate)
          .single();
          
        const activeHours = specialHours || businessHours;
        
        // Check if kitchen is closed
        const kitchenClosed = !activeHours || 
                             activeHours.is_closed || 
                             activeHours.is_kitchen_closed ||
                             (!activeHours.kitchen_opens || !activeHours.kitchen_closes);
        
        if (kitchenClosed) {
          return { error: 'Kitchen is closed on the selected date' };
        }
        
        // Check if booking time is within kitchen hours
        if (newTime < activeHours.kitchen_opens || newTime >= activeHours.kitchen_closes) {
          return { error: `Kitchen is only open from ${formatTime12Hour(activeHours.kitchen_opens)} to ${formatTime12Hour(activeHours.kitchen_closes)} on this day` };
        }
      }
    }
    
    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('table_bookings')
      .update({
        ...updates,
        modification_badge: currentBooking.modification_count + 1,
      })
      .eq('id', bookingId)
      .select()
      .single();
      
    if (updateError) {
      console.error('Booking update error:', updateError);
      return { error: 'Failed to update booking' };
    }
    
    // Log modification
    await supabase
      .from('table_booking_modifications')
      .insert({
        booking_id: bookingId,
        modified_by: (await supabase.auth.getUser()).data.user?.id,
        modification_type: 'manual_update',
        old_values: currentBooking,
        new_values: updatedBooking,
      });
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: currentBooking.booking_reference,
        changes: updates,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: updatedBooking };
  } catch (error) {
    console.error('Update booking error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Cancel table booking
export async function cancelTableBooking(bookingId: string, reason: string) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to cancel bookings' };
    }
    
    // Get booking
    const { data: booking, error: fetchError } = await adminSupabase
      .from('table_bookings')
      .select('*, table_booking_payments(*)')
      .eq('id', bookingId)
      .single();
      
    if (fetchError || !booking) {
      return { error: 'Booking not found' };
    }
    
    // Check if already cancelled
    if (booking.status === 'cancelled') {
      return { error: 'Booking is already cancelled' };
    }
    
    // Calculate refund if payment exists
    let refundAmount = 0;
    if (booking.table_booking_payments?.length > 0) {
      const { data: refundCalc } = await supabase.rpc('calculate_refund_amount', {
        p_booking_id: bookingId,
      });
      
      refundAmount = refundCalc?.[0]?.refund_amount || 0;
    }
    
    // Update booking status
    const { error: updateError } = await adminSupabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', bookingId);
      
    if (updateError) {
      console.error('Booking cancellation error:', updateError);
      return { error: 'Failed to cancel booking' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'cancel',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        reason,
        refund_amount: refundAmount,
      }
    });
    
    // Send cancellation SMS
    const refundMessage = refundAmount > 0 
      ? `A refund of £${refundAmount.toFixed(2)} will be processed within 3-5 business days.`
      : 'No payment was taken for this booking.';
    
    const smsResult = await queueCancellationSMS(bookingId, refundMessage);
    if (smsResult.error) {
      console.error('Queue cancellation error:', smsResult.error);
    }
    
    // Also send cancellation email
    const emailResult = await sendBookingCancellationEmail(bookingId, refundMessage);
    if (emailResult.error) {
      console.error('Send cancellation email error:', emailResult.error);
    }
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { 
      success: true, 
      data: { 
        booking_id: bookingId,
        refund_eligible: refundAmount > 0,
        refund_amount: refundAmount,
      }
    };
  } catch (error) {
    console.error('Cancel booking error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Mark booking as no-show
export async function markBookingNoShow(bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to update bookings' };
    }
    
    // Update booking status
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .update({
        status: 'no_show',
        no_show_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();
      
    if (error) {
      console.error('No-show update error:', error);
      return { error: 'Failed to mark as no-show' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'no_show',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        customer_id: booking.customer_id,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: booking };
  } catch (error) {
    console.error('No-show error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Mark booking as completed
export async function markBookingCompleted(bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to update bookings' };
    }
    
    // Update booking status
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();
      
    if (error) {
      console.error('Complete booking error:', error);
      return { error: 'Failed to mark as completed' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'complete',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: booking };
  } catch (error) {
    console.error('Complete booking error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get bookings for a specific date
export async function getBookingsByDate(date: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view bookings' };
    }
    
    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          email
        ),
        table_booking_items(*)
      `)
      .eq('booking_date', date)
      .order('booking_time', { ascending: true });
      
    if (error) {
      console.error('Fetch bookings error:', error);
      return { error: 'Failed to fetch bookings' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Search bookings
export async function searchBookings(searchTerm: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to search bookings' };
    }
    
    // Search by reference, customer name, or phone
    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          email
        )
      `)
      .or(`booking_reference.ilike.%${searchTerm}%`)
      .order('booking_date', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('Search bookings error:', error);
      return { error: 'Failed to search bookings' };
    }
    
    // Also search by customer details
    const phoneVariants = generatePhoneVariants(searchTerm);
    const { data: customerBookings } = await supabase
      .from('customers')
      .select(`
        id,
        first_name,
        last_name,
        mobile_number,
        email,
        table_bookings(*)
      `)
      .or([
        `first_name.ilike.%${searchTerm}%`,
        `last_name.ilike.%${searchTerm}%`,
        `email.ilike.%${searchTerm}%`,
        phoneVariants.map(v => `mobile_number.eq.${v}`).join(',')
      ].join(','));
      
    // Combine results
    const allBookings = [...(data || [])];
    if (customerBookings) {
      customerBookings.forEach(customer => {
        if (customer.table_bookings) {
          customer.table_bookings.forEach((booking: any) => {
            if (!allBookings.find(b => b.id === booking.id)) {
              allBookings.push({
                ...booking,
                customer,
              });
            }
          });
        }
      });
    }
    
    return { data: allBookings };
  } catch (error) {
    console.error('Search bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
