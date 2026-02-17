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
    logger.warn('Webhook logging client unavailable: missing public Supabase environment variables')
    return null
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
function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id'
  ]

  const sanitized: Record<string, string> = {}
  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  // Preserve only signature presence, never the raw value.
  sanitized['x-twilio-signature-present'] = headers['x-twilio-signature'] ? 'true' : 'false'
  return sanitized
}

function sanitizeParamsForLog(params: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {}
  const keys = [
    'MessageSid',
    'SmsSid',
    'MessageStatus',
    'SmsStatus',
    'From',
    'To',
    'ErrorCode',
    'AccountSid'
  ]

  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string' && value.length > 0) {
      picked[key] = truncate(value, 200) as string
    }
  }

  if (params.Body) {
    picked.BodyLength = String(params.Body.length)
  }

  return picked
}

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
    const sanitizedHeaders = sanitizeHeadersForLog(headers)
    const sanitizedParams = sanitizeParamsForLog(params)
    const logEntry = {
      webhook_type: 'twilio',
      status,
      headers: sanitizedHeaders,
      body: truncate(body, 1000),
      params: sanitizedParams,
      error_message: error,
      error_details: errorDetails,
      message_sid: params.MessageSid || params.SmsSid,
      from_number: params.From,
      to_number: params.To,
      message_body: truncate(params.Body, 300),
      ...additionalData
    };
    
    const { error: logError } = await (client
      .from('webhook_logs') as any)
      .insert(logEntry);
      
    if (logError) {
      logger.warn('Failed to log Twilio webhook attempt', {
        metadata: { error: logError.message }
      });
    }
  } catch (e) {
    logger.warn('Exception while logging Twilio webhook attempt', {
      error: e instanceof Error ? e : new Error(String(e))
    });
  }
}

// Verify Twilio webhook signature
function verifyTwilioSignature(request: NextRequest, body: string): boolean {
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioAuthToken) {
    logger.error('TWILIO_AUTH_TOKEN not configured for webhook validation');
    return false;
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature');
  if (!twilioSignature) {
    logger.warn('Missing X-Twilio-Signature header on Twilio webhook');
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

async function recordAnalyticsEventSafe(
  adminClient: any,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: string
) {
  try {
    await recordAnalyticsEvent(adminClient, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record Twilio webhook analytics event', {
      metadata: {
        context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

async function applySmsDeliveryOutcome(
  adminClient: any,
  input: {
    customerId?: string | null
    messageStatus?: string | null
    errorCode?: string | null
  }
) {
  const normalizedStatus = typeof input.messageStatus === 'string'
    ? input.messageStatus.toLowerCase()
    : null

  if (!normalizedStatus) {
    return
  }

  const isDelivered = normalizedStatus === 'delivered'
  const isFailureStatus = ['failed', 'undelivered', 'canceled'].includes(normalizedStatus)
  if (!isDelivered && !isFailureStatus) {
    return
  }

  const customerId = input.customerId
  if (!customerId) {
    return
  }

  const nowIso = new Date().toISOString()

  const { data: customer, error: customerError } = await adminClient
    .from('customers')
    .select('id, sms_status, sms_opt_in, sms_delivery_failures')
    .eq('id', customerId)
    .maybeSingle()

  if (customerError) {
    throw new Error(`Failed to load customer for SMS delivery outcome update: ${customerError.message}`)
  }

  if (!customer) {
    throw new Error(`Customer row missing for SMS delivery outcome update: ${customerId}`)
  }

  if (isDelivered) {
    const { data: deliveredCustomer, error: deliveredUpdateError } = await adminClient
      .from('customers')
      .update({
        sms_delivery_failures: 0,
        last_sms_failure_reason: null,
        last_successful_sms_at: nowIso
      })
      .eq('id', customerId)
      .select('id')
      .maybeSingle()

    if (deliveredUpdateError) {
      throw new Error(
        `Failed to reset SMS delivery failure counters after successful delivery: ${deliveredUpdateError.message}`
      )
    }
    if (!deliveredCustomer) {
      throw new Error(`SMS delivery success update affected no customer rows: ${customerId}`)
    }

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

  const { data: failedCustomer, error: failureUpdateError } = await adminClient
    .from('customers')
    .update(updatePayload)
    .eq('id', customerId)
    .select('id')
    .maybeSingle()

  if (failureUpdateError) {
    throw new Error(`Failed to update SMS delivery failure counters: ${failureUpdateError.message}`)
  }

  if (!failedCustomer) {
    throw new Error(`SMS delivery failure update affected no customer rows: ${customerId}`)
  }

  if (shouldDeactivate && customer.sms_status !== 'sms_deactivated') {
    try {
      await recordAnalyticsEvent(adminClient, {
        customerId,
        eventType: 'sms_deactivated',
        metadata: {
          reason: 'delivery_failures',
          failures: nextFailures
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record sms_deactivated analytics event', {
        metadata: {
          customerId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }
  }
}

async function findMessageBySid(
  adminClient: any,
  messageSid: string
): Promise<{ id: string; twilio_status?: string | null; customer_id?: string | null } | null> {
  const { data, error } = await adminClient
    .from('messages')
    .select('id, twilio_status, customer_id')
    .eq('twilio_message_sid', messageSid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to look up message by SID: ${error.message}`)
  }

  return data ?? null
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Initialize variables for logging
  let body = '';
  let headers: Record<string, string> = {};
  const params: Record<string, string> = {};
  let publicClient: any = null;
  let adminClient: any = null;
  
  try {
    // Get headers
    headers = Object.fromEntries(request.headers.entries());

    // Get public client for logging
    publicClient = getPublicSupabaseClient();
    if (!publicClient) {
      logger.warn('Twilio webhook proceeding without webhook_logs writes (public client unavailable)');
    }
    
    // Get body
    body = await request.text();

    // Parse parameters
    const formData = new URLSearchParams(body);
    formData.forEach((value, key) => {
      params[key] = value;
    });
    
    // Log the initial webhook receipt
    if (publicClient) {
      await logWebhookAttempt(publicClient, 'received', headers, body, params);
    }
    
    // Always verify signature unless explicitly disabled in non-production environments.
    const skipValidationRequested = skipTwilioSignatureValidation();
    const skipValidation = skipValidationRequested && process.env.NODE_ENV !== 'production';
    
    if (!skipValidation) {
      const isValid = verifyTwilioSignature(request, body);
      
      if (!isValid) {
        logger.warn('Invalid Twilio webhook signature');
        
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
      logger.warn('Skipping Twilio signature validation for local development/testing only', {
        metadata: {
          env: process.env.NODE_ENV || 'unknown'
        }
      });
    }
    
    // Get admin client for database operations
    adminClient = createAdminClient();
    
    // Determine webhook type and process
    const hasBodyPayload = Boolean(params.Body && params.From && params.To)
    const webhookStatus = (params.MessageStatus || params.SmsStatus || '').toLowerCase()
    const isInboundMessage = hasBodyPayload && (webhookStatus === '' || webhookStatus === 'received')
    const isStatusUpdate = Boolean(webhookStatus) && !isInboundMessage

    if (isInboundMessage) {
      return await handleInboundSMS(publicClient, adminClient, headers, body, params);
    } else if (isStatusUpdate) {
      return await handleStatusUpdate(publicClient, adminClient, headers, body, params);
    } else {
      if (publicClient) {
        await logWebhookAttempt(publicClient, 'unknown_type', headers, body, params, 'Could not determine webhook type');
      }
      return NextResponse.json({ success: true, message: 'Unknown webhook type' });
    }
    
  } catch (error: any) {
    logger.error('Twilio webhook handler failed', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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
    logger.info('Twilio webhook completed', {
      metadata: { durationMs: Date.now() - startTime }
    });
  }
}

async function handleInboundSMS(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  try {
    const messageBody = params.Body?.trim() || '';
    const fromNumber = params.From;
    const toNumber = params.To;
    const messageSid = params.MessageSid || params.SmsSid;

    if (!fromNumber || !toNumber || !messageSid) {
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'invalid_payload',
          headers,
          body,
          params,
          'Missing required inbound webhook fields'
        );
      }
      return NextResponse.json({ success: true, note: 'Missing required fields' });
    }

    const existingInboundMessage = await findMessageBySid(adminClient, messageSid);
    if (existingInboundMessage?.id) {
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'duplicate_inbound',
          headers,
          body,
          params,
          undefined,
          undefined,
          { message_id: existingInboundMessage.id }
        );
      }
      return NextResponse.json({ success: true, messageId: existingInboundMessage.id, duplicate: true });
    }

    let canonicalFromNumber: string;
    try {
      canonicalFromNumber = formatPhoneForStorage(fromNumber);
    } catch {
      throw new Error('Failed to normalize inbound sender phone number');
    }
    const normalizedFromNumber = canonicalFromNumber;
    
    // Look up or create customer
    let customer;
    
    // Try to find existing customer
    const phoneVariants = generatePhoneVariants(normalizedFromNumber);

    const orClauses = [
      `mobile_e164.eq.${canonicalFromNumber}`,
      ...phoneVariants.map(variant => `mobile_number.eq.${variant}`)
    ];

    if (orClauses.length === 0) {
      throw new Error('Unable to resolve customer phone lookup variants')
    }

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
        const createErrorCode = (createError as { code?: string } | null)?.code
        if (createErrorCode === '23505') {
          const { data: concurrentCustomers, error: concurrentLookupError } = await adminClient
            .from('customers')
            .select('*')
            .or(orConditions)
            .limit(1)

          if (concurrentLookupError) {
            throw new Error(`Failed to resolve concurrently-created customer: ${concurrentLookupError.message}`)
          }

          if (!concurrentCustomers || concurrentCustomers.length === 0) {
            throw new Error('Failed to resolve concurrently-created customer after duplicate insert')
          }

          customer = concurrentCustomers[0]
        } else {
          throw new Error(`Failed to create customer: ${createError.message}`);
        }
      } else {
        customer = newCustomer;
      }

      if (!customer) {
        throw new Error('Failed to resolve inbound webhook customer')
      }
    } else {
      customer = customers[0];

      if (!customer.mobile_e164) {
        const { data: syncedCustomer, error: mobileSyncError } = await adminClient
          .from('customers')
          .update({
            mobile_e164: canonicalFromNumber
          })
          .eq('id', customer.id)
          .select('id')
          .maybeSingle()

        if (mobileSyncError) {
          logger.warn('Failed syncing canonical mobile_e164 from inbound webhook', {
            metadata: { customerId: customer.id, error: mobileSyncError.message }
          })
        } else if (!syncedCustomer) {
          logger.warn('Inbound mobile_e164 sync affected no customer rows', {
            metadata: { customerId: customer.id }
          })
        }
      }
    }
    
    // Check for opt-out keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
    const messageUpper = messageBody.toUpperCase();
    const isOptOut = stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '));
    
    if (isOptOut) {
      const { data: optedOutCustomer, error: optOutError } = await adminClient
        .from('customers')
        .update({
          sms_opt_in: false,
          sms_status: 'opted_out',
          marketing_sms_opt_in: false
        })
        .eq('id', customer.id)
        .select('id')
        .maybeSingle();
      
      if (optOutError) {
        // Fail closed so Twilio retries and the opt-out is not silently dropped.
        throw new Error(
          `Failed to update customer opt-out status from inbound keyword: ${optOutError.message}`
        )
      }

      if (!optedOutCustomer) {
        // Fail closed: we should never ACK an opt-out keyword if we cannot confirm the preference write.
        throw new Error('Inbound opt-out update affected no customer rows')
      }

      {
        await recordAnalyticsEventSafe(adminClient, {
          customerId: customer.id,
          eventType: 'sms_opted_out',
          metadata: {
            source: 'twilio_inbound_stop',
            keyword: messageUpper.split(' ')[0]
          }
        }, 'inbound_opt_out')
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
      const duplicateErrorCode = (messageError as { code?: string } | null)?.code
      if (duplicateErrorCode === '23505') {
        const duplicateMessage = await findMessageBySid(adminClient, messageSid)
        if (duplicateMessage?.id) {
          if (publicClient) {
            await logWebhookAttempt(
              publicClient,
              'duplicate_inbound',
              headers,
              body,
              params,
              undefined,
              undefined,
              { message_id: duplicateMessage.id }
            )
          }
          return NextResponse.json({ success: true, messageId: duplicateMessage.id, duplicate: true })
        }
      }
      throw new Error(`Failed to save message: ${messageError.message}`);
    }

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
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Inbound Twilio webhook handling failed', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        errorMessage,
        { stack: error?.stack }
      );
    }
    
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

async function handleStatusUpdate(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  try {
    const messageSid = params.MessageSid || params.SmsSid;
    const messageStatus = (params.MessageStatus || params.SmsStatus)?.toLowerCase();
    const errorCode = params.ErrorCode;
    const errorMessage = params.ErrorMessage;

    if (!messageSid || !messageStatus) {
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'invalid_status_payload',
          headers,
          body,
          params,
          'Missing required fields: MessageSid or MessageStatus'
        )
      }
      return NextResponse.json({ success: true, note: 'Missing required status fields' });
    }

    // First, try to find the existing message
    const { data: existingMessage, error: fetchError } = await adminClient
      .from('messages')
      .select('id, status, twilio_status, direction, customer_id, sent_at')
      .eq('twilio_message_sid', messageSid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (fetchError) {
      logger.warn('Failed to load message for Twilio status webhook', {
        metadata: {
          sid: messageSid,
          status: messageStatus,
          error: fetchError.message
        }
      })

      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'message_lookup_failed',
          headers,
          body,
          params,
          'Message lookup failed',
          {
            messageSid,
            status: messageStatus
          }
        );
      }

      return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }

    if (!existingMessage) {
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

    if ((existingMessage.twilio_status || '').toLowerCase() === messageStatus) {
      await applySmsDeliveryOutcome(adminClient, {
        customerId: existingMessage.customer_id,
        messageStatus,
        errorCode: errorCode || null
      })

      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'duplicate_status',
          headers,
          body,
          params,
          undefined,
          undefined,
          { message_id: existingMessage.id }
        )
      }
      return NextResponse.json({ success: true, note: 'Duplicate status ignored' })
    }
    
    // Check if this is a valid status progression
    if (!isStatusUpgrade(existingMessage.twilio_status, messageStatus)) {
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

      if (historyError) {
        logger.warn('Failed saving status regression audit entry from Twilio webhook', {
          metadata: {
            sid: messageSid,
            status: messageStatus,
            error: historyError.message
          }
        })
      }
      
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
        ...(messageStatus === 'canceled' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'sent' && !existingMessage.sent_at && { sent_at: new Date().toISOString() })
      })
      .eq('twilio_message_sid', messageSid)
      .eq('id', existingMessage.id) // Extra safety with ID match
      .select('id')
      .maybeSingle();
    
    if (updateError) {
      logger.warn('Failed to update message status from Twilio webhook', {
        metadata: {
          sid: messageSid,
          status: messageStatus,
          error: updateError.message
        }
      });

      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'status_update_failed',
          headers,
          body,
          params,
          updateError.message,
          { messageSid, status: messageStatus, message_id: existingMessage.id }
        )
      }

      return NextResponse.json({ error: 'Message status update failed' }, { status: 500 })
    }

    if (!message) {
      logger.warn('Twilio status update affected no message rows; treating as idempotent success', {
        metadata: {
          sid: messageSid,
          status: messageStatus,
          messageId: existingMessage.id
        }
      })

      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'status_update_noop',
          headers,
          body,
          params,
          undefined,
          undefined,
          { messageSid, status: messageStatus, message_id: existingMessage.id }
        )
      }

      return NextResponse.json({ success: true, note: 'Status update already applied or message missing' })
    }
    
    // Save status history (append-only audit log)
    const { error: historyError } = await adminClient
      .from('message_delivery_status')
      .insert({
        message_id: message.id,
        status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage || (errorCode ? formatErrorMessage(errorCode) : null),
        raw_webhook_data: params,
        created_at: new Date().toISOString()
      });
    
    if (historyError) {
      logger.warn('Failed to save message status history from Twilio webhook', {
        metadata: {
          sid: messageSid,
          status: messageStatus,
          error: historyError.message
        }
      });
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
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Twilio status webhook handling failed', {
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        errorMessage,
        { stack: error?.stack }
      );
    }
    
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
