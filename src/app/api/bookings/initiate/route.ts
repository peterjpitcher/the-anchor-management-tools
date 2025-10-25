import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import { ukPhoneRegex } from '@/lib/validation';
import { formatPhoneForStorage, formatPhoneForDisplay } from '@/lib/validation';
import { generatePhoneVariants } from '@/lib/utils';
import { createShortLinkInternal } from '@/app/actions/short-links';
import twilio from 'twilio';
import { formatTime12Hour } from '@/lib/dateUtils';
import { ensureReplyInstruction } from '@/lib/sms/support';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { recordOutboundSmsMessage } from '@/lib/sms/logging';

const initiateBookingSchema = z.object({
  event_id: z.string().uuid(),
  mobile_number: z.string().regex(ukPhoneRegex, 'Invalid UK phone number'),
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (_req, apiKey) => {
    try {
      // Create a response object to track errors
      const debugInfo: any = {
        timestamp: new Date().toISOString(),
        apiKeyId: apiKey?.id || 'unknown',
        errors: [] as string[],
        warnings: [] as string[],
      };
      
      const body = await request.json();
      debugInfo.requestBody = body;
    
    // Validate input
    const validation = initiateBookingSchema.safeParse(body);
    if (!validation.success) {
      debugInfo.errors.push(`Validation failed: ${validation.error.errors[0].message}`);
      return createErrorResponse(
        validation.error.errors[0].message,
        'VALIDATION_ERROR',
        400,
        { debug: debugInfo }
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
      debugInfo.errors.push(`Event not found: ${eventError?.message || 'No event returned'}`);
      return createErrorResponse('Event not found', 'NOT_FOUND', 404, { debug: debugInfo });
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
    const { data: customers } = await supabase
      .from('customers')
      .select('id, first_name, last_name, sms_opt_in')
      .or(phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(','));
    
    const existingCustomer = customers && customers.length > 0 ? customers[0] : null;

    // Check if customer has opted out (sms_opt_in = false)
    if (existingCustomer && existingCustomer.sms_opt_in === false) {
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
      debugInfo.errors.push(`Database error: ${pendingError.message}`);
      return createErrorResponse('Failed to initiate booking', 'DATABASE_ERROR', 500, {
        debug: debugInfo,
        pendingError: pendingError.message
      });
    }

    // Create short link for confirmation
    const confirmationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/booking-confirmation/${bookingToken}`;
    const shortLinkResult = await createShortLinkInternal({
      destination_url: confirmationUrl,
      link_type: 'custom',
      expires_at: expiresAt.toISOString(),
      metadata: {
        type: 'booking_confirmation',
        event_id,
        mobile_number: standardizedPhone,
      },
    });

    if ('error' in shortLinkResult || !shortLinkResult.data) {
      const errorMessage = 'error' in shortLinkResult ? shortLinkResult.error : 'No link created';
      debugInfo.errors.push(`Short link error: ${errorMessage}`);
      return createErrorResponse('Failed to create confirmation link', 'SYSTEM_ERROR', 500, {
        debug: debugInfo,
        linkError: errorMessage
      });
    }
    
    const shortLink = shortLinkResult.data;

    // Prepare SMS message
    const displayPhone = formatPhoneForDisplay(standardizedPhone);
    const customerName = existingCustomer 
      ? `${existingCustomer.first_name} ${existingCustomer.last_name}`
      : 'Guest';

    const eventDateDisplay = new Date(event.date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const eventTimeFriendly = event.time ? formatTime12Hour(event.time) : null;
    const eventSlot = eventTimeFriendly ? `${eventDateDisplay} at ${eventTimeFriendly}` : eventDateDisplay;

    const baseMessage = existingCustomer
      ? `Hi ${existingCustomer.first_name}, please confirm your booking for ${event.name} on ${eventSlot}.`
      : `Welcome to The Anchor! Please confirm your booking for ${event.name} on ${eventSlot}.`;

    const confirmationSentence = `Click here to confirm: ${shortLink.full_url}`;
    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || null;
    const smsMessage = ensureReplyInstruction(`${baseMessage} ${confirmationSentence}`.trim(), supportPhone);

    // Send SMS and store details for later recording
    let smsSent = false;
    let smsDetails = null;
    
    try {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        debugInfo.warnings.push('Twilio credentials not configured');
        smsSent = false;
      } else if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
        debugInfo.warnings.push('Twilio sender not configured');
        smsSent = false;
      } else {
        const twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

        // Import webhook URL from centralized config
        const webhookUrl = process.env.WEBHOOK_BASE_URL || 
                          process.env.NEXT_PUBLIC_APP_URL || 
                          'https://management.orangejelly.co.uk';
        
        const messageParams: any = {
          body: smsMessage,
          to: standardizedPhone,
          statusCallback: `${webhookUrl}/api/webhooks/twilio`,
          statusCallbackMethod: 'POST',
        };

        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
          messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        } else if (process.env.TWILIO_PHONE_NUMBER) {
          messageParams.from = process.env.TWILIO_PHONE_NUMBER;
        }

        const twilioMessage = await twilioClient.messages.create(messageParams);
        debugInfo.smsSid = twilioMessage.sid;
        smsSent = true;

        const ensured = await ensureCustomerForPhone(supabase, standardizedPhone);
        const customerIdForLogging = ensured.customerId;

        // Calculate segments and cost
        const messageLength = smsMessage.length;
        const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153);
        const costUsd = segments * 0.04;

        // Store SMS details in pending_bookings metadata for later recording
        smsDetails = {
          message_sid: twilioMessage.sid,
          body: smsMessage,
          from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
          to_number: twilioMessage.to,
          segments,
          cost_usd: costUsd,
          sent_at: new Date().toISOString(),
        };

        await supabase
          .from('pending_bookings')
          .update({
            metadata: {
              initial_sms: smsDetails,
            }
          })
          .eq('token', bookingToken);

        if (customerIdForLogging) {
          const messageId = await recordOutboundSmsMessage({
            supabase,
            customerId: customerIdForLogging,
            to: twilioMessage.to,
            body: smsMessage,
            sid: twilioMessage.sid,
            fromNumber: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || null,
            status: twilioMessage.status || 'queued',
            twilioStatus: twilioMessage.status || 'queued',
            metadata: {
              pending_booking_token: bookingToken,
              context: 'booking_initiation'
            },
            sentAt: smsDetails.sent_at
          });

          if (!messageId) {
            debugInfo.warnings.push('SMS sent but not recorded in messages table');
          }
        } else {
          debugInfo.warnings.push('SMS sent but customer record not resolved for logging');
        }
      }
    } catch (smsError: any) {
      debugInfo.errors.push(`SMS error: ${smsError?.message || 'Unknown SMS error'}`);
      debugInfo.smsError = smsError?.message;
      smsSent = false;
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
        sms_sent: smsSent,
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
      sms_sent: smsSent,
      debug: process.env.NODE_ENV !== 'production' ? debugInfo : undefined,
      _debug_summary: {
        errors: debugInfo.errors.length,
        warnings: debugInfo.warnings.length,
        sms_attempted: !!process.env.TWILIO_ACCOUNT_SID,
        sms_sent: smsSent,
      }
    }, 201);
    } catch (unexpectedError: any) {
      // Catch any unexpected errors
      return createErrorResponse(
        'An unexpected error occurred',
        'INTERNAL_ERROR',
        500,
        {
          error: unexpectedError?.message || 'Unknown error',
          stack: process.env.NODE_ENV !== 'production' ? unexpectedError?.stack : undefined
        }
      );
    }
  }, ['write:bookings'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
