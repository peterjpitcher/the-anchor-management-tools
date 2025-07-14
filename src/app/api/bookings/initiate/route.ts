import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import { ukPhoneRegex } from '@/lib/validation';
import { formatPhoneForStorage, formatPhoneForDisplay } from '@/lib/validation';
import { generatePhoneVariants } from '@/lib/utils';
import { createShortLinkInternal } from '@/app/actions/short-links';
import { sendSms } from '@/app/actions/sms';

const initiateBookingSchema = z.object({
  event_id: z.string().uuid(),
  mobile_number: z.string().regex(ukPhoneRegex, 'Invalid UK phone number'),
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (_req, apiKey) => {
    const body = await request.json();
    
    // Validate input
    const validation = initiateBookingSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors[0].message,
        'VALIDATION_ERROR',
        400
      );
    }

    const { event_id, mobile_number } = validation.data;
    const supabase = createAdminClient();
    
    // Check event availability
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        event_status,
        bookings(seats)
      `)
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }

    // Validate event status
    if (event.event_status !== 'scheduled') {
      return createErrorResponse(
        'Event is not available for booking',
        'EVENT_NOT_AVAILABLE',
        400
      );
    }

    // Check capacity
    const bookedSeats = event.bookings?.reduce((sum: number, booking: any) => sum + (booking.seats || 0), 0) || 0;
    const capacity = event.capacity || 100;
    const availableSeats = capacity - bookedSeats;

    if (availableSeats < 1) {
      return createErrorResponse(
        'Event is fully booked',
        'EVENT_FULL',
        400
      );
    }

    // Standardize phone number
    const standardizedPhone = formatPhoneForStorage(mobile_number);
    const phoneVariants = generatePhoneVariants(standardizedPhone);

    // Check if customer exists
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, first_name, last_name, sms_opt_in, sms_opt_out')
      .or(phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(','))
      .single();

    // Check if customer has opted out
    if (existingCustomer?.sms_opt_out) {
      return createErrorResponse(
        'This phone number has opted out of SMS communications',
        'SMS_OPT_OUT',
        400
      );
    }

    // Create a pending booking token
    const bookingToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    // Store pending booking details
    const { error: pendingError } = await supabase
      .from('pending_bookings')
      .insert({
        token: bookingToken,
        event_id,
        mobile_number: standardizedPhone,
        customer_id: existingCustomer?.id || null,
        expires_at: expiresAt.toISOString(),
        initiated_by_api_key: apiKey.id,
      });

    if (pendingError) {
      console.error('Failed to create pending booking:', pendingError);
      return createErrorResponse('Failed to initiate booking', 'DATABASE_ERROR', 500);
    }

    // Create short link for confirmation
    const confirmationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/booking-confirmation/${bookingToken}`;
    const { data: shortLink, error: linkError } = await createShortLinkInternal({
      destination_url: confirmationUrl,
      link_type: 'custom',
      expires_at: expiresAt.toISOString(),
      metadata: {
        type: 'booking_confirmation',
        event_id,
        mobile_number: standardizedPhone,
      },
    });

    if (linkError || !shortLink) {
      console.error('Failed to create short link:', linkError);
      return createErrorResponse('Failed to create confirmation link', 'SYSTEM_ERROR', 500);
    }

    // Prepare SMS message
    const displayPhone = formatPhoneForDisplay(standardizedPhone);
    const customerName = existingCustomer 
      ? `${existingCustomer.first_name} ${existingCustomer.last_name}`
      : 'Guest';

    const smsMessage = existingCustomer
      ? `Hi ${existingCustomer.first_name}, please confirm your booking for ${event.name} on ${new Date(event.date).toLocaleDateString('en-GB')} at ${event.time}. Click here to confirm: ${shortLink.full_url}`
      : `Welcome to The Anchor! Please confirm your booking for ${event.name} on ${new Date(event.date).toLocaleDateString('en-GB')} at ${event.time}. Click here to confirm: ${shortLink.full_url}`;

    // Send SMS
    const { error: smsError } = await sendSms({
      to: standardizedPhone,
      body: smsMessage,
    });

    if (smsError) {
      console.error('Failed to send SMS:', smsError);
      // Don't fail the request if SMS fails - they can still use the link
    }

    // Log API event
    await supabase.from('audit_logs').insert({
      user_id: apiKey.id,
      action: 'booking.initiated',
      entity_type: 'pending_booking',
      entity_id: bookingToken,
      metadata: {
        api_key: apiKey.name,
        event_id,
        mobile_number: displayPhone,
        customer_exists: !!existingCustomer,
        sms_sent: !smsError,
      },
    });

    return createApiResponse({
      status: 'pending',
      booking_token: bookingToken,
      confirmation_url: shortLink.full_url,
      expires_at: expiresAt.toISOString(),
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        time: event.time,
        available_seats: availableSeats,
      },
      customer_exists: !!existingCustomer,
      sms_sent: !smsError,
    }, 201);
  }, ['write:bookings'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}