import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { retry, RetryConfigs } from '@/lib/retry';
import { logger } from '@/lib/logger';
import { mapTwilioStatus, isStatusUpgrade, formatErrorMessage } from '@/lib/sms-status';
import { skipTwilioSignatureValidation } from '@/lib/env';
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils';
import { recordAnalyticsEvent } from '@/lib/analytics/events';

// Create public Supabase client for logging (no auth required)
function getPublicSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'x-client-info': 'supabase-anon-webhook'
      }
    }
  })
}

// Log webhook attempt to database
async function logWebhookAttempt(
  client: ReturnType<typeof createClient>,
  status: string,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>,
  error?: string,
  errorDetails?: unknown,
  additionalData?: Record<string, unknown>
) {
  try {
    const logEntry = {
      webhook_type: 'twilio',
      status,
      headers,
      body: body.substring(0, 10000), // Limit body size
      params,
      error_message: error,
      error_details: errorDetails,
      message_sid: params.MessageSid || params.SmsSid,
      from_number: params.From,
      to_number: params.To,
      message_body: params.Body?.substring(0, 1000), // Limit message size
      ...additionalData
    };
    
    const { error: logError } = await (client
      .from('webhook_logs') as any)
      .insert(logEntry);
      
    if (logError) {
      console.error('Failed to log webhook attempt:', logError);
    }
  } catch (e) {
    console.error('Exception while logging webhook:', e);
  }
}

// Verify Twilio webhook signature
function verifyTwilioSignature(request: NextRequest, body: string): boolean {
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioAuthToken) {
    console.error('TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature');
  if (!twilioSignature) {
    console.error('Missing X-Twilio-Signature header');
    return false;
  }

  // Construct the full URL
  const url = request.url;
  
  // Parse form data for validation
  const params = new URLSearchParams(body);
  const paramsObject: Record<string, string> = {};
  params.forEach((value, key) => {
    paramsObject[key] = value;
  });

  // Verify the signature
  return twilio.validateRequest(
    twilioAuthToken,
    twilioSignature,
    url,
    paramsObject
  );
}

async function applySmsDeliveryOutcome(
  adminClient: any,
  input: {
    customerId?: string | null
    messageStatus?: string | null
    errorCode?: string | null
  }
) {
  const customerId = input.customerId
  if (!customerId || !input.messageStatus) {
    return
  }

  const normalizedStatus = input.messageStatus.toLowerCase()
  const nowIso = new Date().toISOString()

  const { data: customer, error: customerError } = await adminClient
    .from('customers')
    .select('id, sms_status, sms_opt_in, sms_delivery_failures')
    .eq('id', customerId)
    .maybeSingle()

  if (customerError || !customer) {
    return
  }

  if (normalizedStatus === 'delivered') {
    await adminClient
      .from('customers')
      .update({
        sms_delivery_failures: 0,
        last_sms_failure_reason: null,
        last_successful_sms_at: nowIso
      })
      .eq('id', customerId)

    return
  }

  const isFailureStatus = ['failed', 'undelivered', 'canceled'].includes(normalizedStatus)
  if (!isFailureStatus) {
    return
  }

  const nextFailures = Number(customer.sms_delivery_failures || 0) + 1
  const shouldDeactivate = nextFailures > 3 && customer.sms_status !== 'opted_out'
  const updatePayload: Record<string, unknown> = {
    sms_delivery_failures: nextFailures,
    last_sms_failure_reason: input.errorCode ? formatErrorMessage(input.errorCode) : 'Message delivery failed'
  }

  if (shouldDeactivate && customer.sms_status !== 'sms_deactivated') {
    updatePayload.sms_status = 'sms_deactivated'
    updatePayload.sms_opt_in = false
    updatePayload.sms_deactivated_at = nowIso
    updatePayload.sms_deactivation_reason = 'delivery_failures'
  }

  await adminClient
    .from('customers')
    .update(updatePayload)
    .eq('id', customerId)

  if (shouldDeactivate && customer.sms_status !== 'sms_deactivated') {
    await recordAnalyticsEvent(adminClient, {
      customerId,
      eventType: 'sms_deactivated',
      metadata: {
        reason: 'delivery_failures',
        failures: nextFailures
      }
    })
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('=== TWILIO WEBHOOK START ===');
  console.log('Time:', new Date().toISOString());
  
  // Initialize variables for logging
  let body = '';
  let headers: Record<string, string> = {};
  const params: Record<string, string> = {};
  let publicClient: any = null;
  let adminClient: any = null;
  
  try {
    // Get headers
    headers = Object.fromEntries(request.headers.entries());
    console.log('Headers received:', headers);
    
    
    // Get public client for logging
    publicClient = getPublicSupabaseClient();
    if (!publicClient) {
      console.error('Failed to create public Supabase client');
    }
    
    // Get body
    body = await request.text();
    console.log('Body length:', body.length);
    console.log('Body preview:', body.substring(0, 200));
    
    // Parse parameters
    const formData = new URLSearchParams(body);
    formData.forEach((value, key) => {
      params[key] = value;
    });
    console.log('Parsed params:', params);
    
    // Log the initial webhook receipt
    if (publicClient) {
      await logWebhookAttempt(publicClient, 'received', headers, body, params);
    }
    
    // Always verify signature unless explicitly disabled (NEVER disable in production)
    const skipValidation = skipTwilioSignatureValidation();
    
    if (!skipValidation) {
      const isValid = verifyTwilioSignature(request, body);
      console.log('Signature validation result:', isValid);
      console.log('Auth token configured:', !!process.env.TWILIO_AUTH_TOKEN);
      console.log('Signature header present:', !!headers['x-twilio-signature']);
      
      if (!isValid) {
        console.error('Invalid webhook signature');
        console.error('Request URL:', request.url);
        console.error('Headers:', headers);
        
        if (publicClient) {
          await logWebhookAttempt(publicClient, 'signature_failed', headers, body, params, 'Invalid Twilio signature', {
            url: request.url,
            authTokenConfigured: !!process.env.TWILIO_AUTH_TOKEN,
            signaturePresent: !!headers['x-twilio-signature']
          });
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.warn('⚠️ Skipping Twilio signature validation - ONLY for local development/testing');
    }
    
    // Get admin client for database operations
    adminClient = createAdminClient();
    
    // Determine webhook type and process
    if (params.Body && params.From && params.To) {
      console.log('Detected INBOUND SMS');
      return await handleInboundSMS(publicClient, adminClient, headers, body, params);
    } else if (params.MessageStatus || params.SmsStatus) {
      console.log('Detected STATUS UPDATE');
      return await handleStatusUpdate(publicClient, adminClient, headers, body, params);
    } else {
      console.log('Unknown webhook type');
      if (publicClient) {
        await logWebhookAttempt(publicClient, 'unknown_type', headers, body, params, 'Could not determine webhook type');
      }
      return NextResponse.json({ success: true, message: 'Unknown webhook type' });
    }
    
  } catch (error: any) {
    console.error('=== WEBHOOK ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    // Try to log the error
    if (publicClient) {
      await logWebhookAttempt(
        publicClient, 
        'exception', 
        headers, 
        body, 
        params, 
        error.message, 
        { stack: error.stack, name: error.name }
      );
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    const duration = Date.now() - startTime;
    console.log(`=== WEBHOOK END (${duration}ms) ===`);
  }
}

async function handleInboundSMS(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING INBOUND SMS ===');
  
  try {
    const messageBody = params.Body.trim();
    const fromNumber = params.From;
    const toNumber = params.To;
    const messageSid = params.MessageSid || params.SmsSid;
    let normalizedFromNumber = fromNumber;
    let canonicalFromNumber: string | null = null;

    try {
      canonicalFromNumber = formatPhoneForStorage(fromNumber);
      normalizedFromNumber = canonicalFromNumber;
    } catch {
      // Fall back to raw value from Twilio if normalization fails.
    }
    
    console.log('Message details:', { from: fromNumber, to: toNumber, sid: messageSid, bodyLength: messageBody.length });
    
    // Look up or create customer
    let customer;
    
    // Try to find existing customer
    const phoneVariants = generatePhoneVariants(normalizedFromNumber);
    console.log('Searching for customer with phone variants:', phoneVariants);

    const orClauses = [
      ...(canonicalFromNumber ? [`mobile_e164.eq.${canonicalFromNumber}`] : []),
      ...phoneVariants.map(variant => `mobile_number.eq.${variant}`)
    ];

    const orConditions = orClauses.join(',');
    const { data: customers, error: customerError } = await adminClient
      .from('customers')
      .select('*')
      .or(orConditions)
      .limit(1);
    
    if (customerError) {
      throw new Error(`Customer lookup failed: ${customerError.message}`);
    }
    
    if (!customers || customers.length === 0) {
      console.log('No existing customer found, creating new one');
      
      // Create new customer with retry
      const { data: newCustomer, error: createError } = await retry(
        async () => {
          return await adminClient
            .from('customers')
            .insert({
              first_name: 'Unknown',
              last_name: `(${fromNumber})`,
              mobile_number: normalizedFromNumber,
              mobile_e164: canonicalFromNumber,
              sms_opt_in: true,
              sms_status: 'active'
            })
            .select()
            .single();
        },
        {
          ...RetryConfigs.database,
          onRetry: (error, attempt) => {
            logger.warn(`Retry creating customer for webhook`, {
              error,
              metadata: { attempt, fromNumber }
            });
          }
        }
      );
      
      if (createError) {
        throw new Error(`Failed to create customer: ${createError.message}`);
      }
      
      customer = newCustomer;
      console.log('Created new customer:', customer.id);
    } else {
      customer = customers[0];
      console.log('Found existing customer:', customer.id);

      if (!customer.mobile_e164 && canonicalFromNumber) {
        await adminClient
          .from('customers')
          .update({
            mobile_e164: canonicalFromNumber
          })
          .eq('id', customer.id)
      }
    }
    
    // Check for opt-out keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
    const messageUpper = messageBody.toUpperCase();
    const isOptOut = stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '));
    
    if (isOptOut) {
      console.log('Processing opt-out request');
      const { error: optOutError } = await adminClient
        .from('customers')
        .update({
          sms_opt_in: false,
          sms_status: 'opted_out',
          marketing_sms_opt_in: false
        })
        .eq('id', customer.id);
      
      if (optOutError) {
        console.error('Failed to update opt-out status:', optOutError);
      } else {
        await recordAnalyticsEvent(adminClient, {
          customerId: customer.id,
          eventType: 'sms_opted_out',
          metadata: {
            source: 'twilio_inbound_stop',
            keyword: messageUpper.split(' ')[0]
          }
        })
      }
    }
    
    // Save the message
    const messageData = {
      customer_id: customer.id,
      direction: 'inbound' as const,
      message_sid: messageSid,
      twilio_message_sid: messageSid,
      body: messageBody,
      status: 'received',
      twilio_status: 'received',
      from_number: normalizedFromNumber,
      to_number: toNumber,
      message_type: 'sms'
    };
    
    console.log('Saving message with data:', messageData);
    
    const { data: savedMessage, error: messageError } = await retry(
      async () => {
        return await adminClient
          .from('messages')
          .insert(messageData)
          .select()
          .single();
      },
      {
        ...RetryConfigs.database,
        onRetry: (error, attempt) => {
          logger.warn(`Retry saving inbound message`, {
            error,
            metadata: { attempt, messageSid }
          });
        }
      }
    );
    
    if (messageError) {
      throw new Error(`Failed to save message: ${messageError.message}`);
    }
    
    console.log('Message saved successfully:', savedMessage.id);
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        undefined,
        undefined,
        { customer_id: customer.id, message_id: savedMessage.id }
      );
    }
    
    return NextResponse.json({ success: true, messageId: savedMessage.id });
    
  } catch (error: any) {
    console.error('Error in handleInboundSMS:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleStatusUpdate(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING STATUS UPDATE ===');
  
  try {
    const messageSid = params.MessageSid || params.SmsSid;
    const messageStatus = (params.MessageStatus || params.SmsStatus)?.toLowerCase();
    const errorCode = params.ErrorCode;
    const errorMessage = params.ErrorMessage;
    
    console.log('Status update:', { sid: messageSid, status: messageStatus, errorCode });
    
    if (!messageSid || !messageStatus) {
      throw new Error('Missing required fields: MessageSid or MessageStatus');
    }
    
    // First, try to find the existing message
    const { data: existingMessage, error: fetchError } = await adminClient
      .from('messages')
      .select('id, status, twilio_status, direction, customer_id')
      .eq('twilio_message_sid', messageSid)
      .single();
    
    if (fetchError || !existingMessage) {
      console.log('Message not found for SID:', messageSid);
      
      // Log to webhook_logs but return success to prevent retries
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'message_not_found',
          headers,
          body,
          params,
          'Message row not found',
          { messageSid }
        );
      }
      
      // Still return success to stop Twilio retries
      return NextResponse.json({ success: true, note: 'Message not found' });
    }
    
    // Check if this is a valid status progression
    if (!isStatusUpgrade(existingMessage.twilio_status, messageStatus)) {
      console.log('Skipping status regression:', {
        current: existingMessage.twilio_status,
        new: messageStatus
      });
      
      // Still log the event for audit purposes
      const { error: historyError } = await adminClient
        .from('message_delivery_status')
        .insert({
          message_id: existingMessage.id,
          status: messageStatus,
          error_code: errorCode,
          error_message: errorMessage,
          raw_webhook_data: params,
          note: 'Status regression prevented'
        });
      
      return NextResponse.json({ success: true, note: 'Status regression prevented' });
    }
    
    // Perform idempotent update with status progression
    const { data: message, error: updateError } = await adminClient
      .from('messages')
      .update({
        status: mapTwilioStatus(messageStatus),
        twilio_status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage || (errorCode ? formatErrorMessage(errorCode) : null),
        updated_at: new Date().toISOString(),
        ...(messageStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
        ...(messageStatus === 'failed' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'undelivered' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'sent' && !existingMessage.sent_at && { sent_at: new Date().toISOString() })
      })
      .eq('twilio_message_sid', messageSid)
      .eq('id', existingMessage.id) // Extra safety with ID match
      .select()
      .single();
    
    if (updateError) {
      console.error('Failed to update message:', updateError);
      // Don't throw - message might not exist yet
    }
    
    // Save status history (append-only audit log)
    const { error: historyError } = await adminClient
      .from('message_delivery_status')
      .insert({
        message_id: message?.id || existingMessage.id,
        status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage || (errorCode ? formatErrorMessage(errorCode) : null),
        raw_webhook_data: params,
        created_at: new Date().toISOString()
      });
    
    if (historyError) {
      console.error('Failed to save status history:', historyError);
    }

    await applySmsDeliveryOutcome(adminClient, {
      customerId: existingMessage.customer_id,
      messageStatus,
      errorCode: errorCode || null
    })
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        undefined,
        undefined,
        { message_id: message?.id }
      );
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('Error in handleStatusUpdate:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
