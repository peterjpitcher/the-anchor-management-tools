import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
import { createAdminClient } from '@/lib/supabase/admin';
import twilio from 'twilio';
import { logger } from '@/lib/logger';
import { mapTwilioStatus, isStatusUpgrade, formatErrorMessage } from '@/lib/sms-status';
import { skipTwilioSignatureValidation } from '@/lib/env';
import { formatPhoneForStorage } from '@/lib/utils';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { getErrorMessage } from '@/lib/errors';
import { handleReplyToBook } from '@/lib/sms/reply-to-book';
import { sendSMS } from '@/lib/twilio';
import { getTwilioWebhookValidationUrl } from '@/lib/twilio-webhook';
import {
  captureTwilioMedia,
  findCustomerByPhone,
  findUnmatchedByTwilioSid,
  recordUnmatchedCommunication,
} from '@/lib/communications/unmatched';
import { isCommunicationBodyMediaCaptureEnabled } from '@/lib/communications/capture';
import { ConsentService } from '@/services/consent';

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
    'AccountSid',
    'Price',
    'PriceUnit',
    'NumSegments'
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

function parseTwilioNumericParam(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildTwilioCostUpdate(params: Record<string, string>): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  const price = parseTwilioNumericParam(params.Price)
  const numSegments = parseTwilioNumericParam(params.NumSegments)
  const priceUnit = params.PriceUnit?.trim()

  if (price !== null) {
    const absolutePrice = Math.abs(price)
    update.price = absolutePrice
    update.cost_usd = absolutePrice
  }

  if (priceUnit) {
    update.price_unit = priceUnit
  }

  if (numSegments !== null) {
    update.segments = Math.max(1, Math.round(numSegments))
  }

  return update
}

async function logWebhookAttempt(
  client: ReturnType<typeof createAdminClient>,
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
    
    // justified: Supabase generated types resolve webhook_logs Insert to never due to version mismatch
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

  const url = getTwilioWebhookValidationUrl(request.url);
  
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

async function applyWhatsAppDeliveryOutcome(
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

  const isDelivered = normalizedStatus === 'delivered' || normalizedStatus === 'read'
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
    .select('id, whatsapp_status, whatsapp_delivery_failures')
    .eq('id', customerId)
    .maybeSingle()

  if (customerError) {
    throw new Error(`Failed to load customer for WhatsApp delivery outcome update: ${customerError.message}`)
  }

  if (!customer) {
    throw new Error(`Customer row missing for WhatsApp delivery outcome update: ${customerId}`)
  }

  if (isDelivered) {
    const isCustomerBlocked = customer.whatsapp_status === 'opted_out'
      || customer.whatsapp_status === 'whatsapp_deactivated'
    const updatePayload: Record<string, unknown> = {
      last_successful_whatsapp_at: nowIso
    }

    if (!isCustomerBlocked) {
      updatePayload.whatsapp_delivery_failures = 0
      updatePayload.last_whatsapp_failure_reason = null
      updatePayload.whatsapp_status = 'active'
    }

    const { error } = await adminClient
      .from('customers')
      .update(updatePayload)
      .eq('id', customerId)

    if (error) {
      throw new Error(`Failed to reset WhatsApp delivery failure counters: ${error.message}`)
    }
    return
  }

  const nextFailures = Number(customer.whatsapp_delivery_failures || 0) + 1
  const shouldDeactivate = nextFailures > 3 && customer.whatsapp_status !== 'opted_out'
  const updatePayload: Record<string, unknown> = {
    whatsapp_delivery_failures: nextFailures,
    last_whatsapp_failure_reason: input.errorCode ? formatErrorMessage(input.errorCode) : 'WhatsApp delivery failed'
  }

  if (shouldDeactivate && customer.whatsapp_status !== 'whatsapp_deactivated') {
    updatePayload.whatsapp_status = 'whatsapp_deactivated'
    updatePayload.whatsapp_opt_in = false
    updatePayload.whatsapp_deactivated_at = nowIso
    updatePayload.whatsapp_deactivation_reason = 'delivery_failures'
  }

  const { error } = await adminClient
    .from('customers')
    .update(updatePayload)
    .eq('id', customerId)

  if (error) {
    throw new Error(`Failed to update WhatsApp delivery failure counters: ${error.message}`)
  }

  if (shouldDeactivate && customer.whatsapp_status !== 'whatsapp_deactivated') {
    await recordAnalyticsEventSafe(adminClient, {
      customerId,
      eventType: 'whatsapp_deactivated',
      metadata: {
        reason: 'delivery_failures',
        failures: nextFailures
      }
    }, 'whatsapp_deactivated')
  }
}

async function findMessageBySid(
  adminClient: any,
  messageSid: string
): Promise<{ id: string; twilio_status?: string | null; customer_id?: string | null; message_type?: string | null } | null> {
  const { data, error } = await adminClient
    .from('messages')
    .select('id, twilio_status, customer_id, message_type')
    .eq('twilio_message_sid', messageSid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to look up message by SID: ${getErrorMessage(error)}`)
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

    // Service-role client for webhook_logs writes and DB operations. A webhook has no
    // user session, so an anon client is rejected by the webhook_logs RLS policy
    // (INSERT WITH CHECK auth.uid() IS NOT NULL). All logging below happens only AFTER
    // signature verification, so service-role cannot persist unverified payloads.
    adminClient = createAdminClient();
    publicClient = adminClient;
    
    // Get body
    body = await request.text();

    // Parse parameters
    const formData = new URLSearchParams(body);
    formData.forEach((value, key) => {
      params[key] = value;
    });
    
    // Always verify signature BEFORE logging to prevent attackers poisoning webhook_logs.
    const skipValidationRequested = skipTwilioSignatureValidation();
    const skipValidation = skipValidationRequested && process.env.NODE_ENV !== 'production';

    if (!skipValidation) {
      const isValid = verifyTwilioSignature(request, body);

      if (!isValid) {
        logger.warn('Invalid Twilio webhook signature');
        // Do NOT log to webhook_logs — unverified payloads must not be persisted.
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      logger.warn('Skipping Twilio signature validation for local development/testing only', {
        metadata: {
          env: process.env.NODE_ENV || 'unknown'
        }
      });
    }

    // Log the webhook receipt only after signature verification has passed.
    if (publicClient) {
      await logWebhookAttempt(publicClient, 'received', headers, body, params);
    }

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
    
  } catch (error: unknown) {
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
        getErrorMessage(error),
        { stack: error instanceof Error ? error.stack : undefined, name: error instanceof Error ? error.name : undefined }
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
    const isWhatsApp = /^whatsapp:/i.test(fromNumber || '') || /^whatsapp:/i.test(toNumber || '')
    const channel = isWhatsApp ? 'whatsapp' : 'sms'
    const rawFromNumber = fromNumber?.replace(/^whatsapp:/i, '') || ''
    const rawToNumber = toNumber?.replace(/^whatsapp:/i, '') || ''

    if (!rawFromNumber || !rawToNumber || !messageSid) {
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

    const existingUnmatched = await findUnmatchedByTwilioSid(adminClient, messageSid)
    if (existingUnmatched?.id) {
      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'duplicate_unmatched_inbound',
          headers,
          body,
          params,
          undefined,
          undefined,
          { unmatched_communication_id: existingUnmatched.id }
        )
      }
      return NextResponse.json({ success: true, unmatchedId: existingUnmatched.id, duplicate: true })
    }

    const { customer, candidates, canonicalPhone } = await findCustomerByPhone(adminClient, rawFromNumber)
    const normalizedFromNumber = canonicalPhone
    let normalizedToNumber = rawToNumber
    try {
      normalizedToNumber = formatPhoneForStorage(rawToNumber)
    } catch {
      normalizedToNumber = rawToNumber
    }

    const attachments = isCommunicationBodyMediaCaptureEnabled()
      ? await captureTwilioMedia({
        adminClient,
        messageSid,
        params,
        channel,
      })
      : []

    if (!customer) {
      const unmatchedId = await recordUnmatchedCommunication({
        adminClient,
        channel,
        twilioMessageSid: messageSid,
        fromAddress: normalizedFromNumber,
        toAddress: normalizedToNumber,
        bodyText: messageBody,
        rawPayload: params,
        attachments,
        candidateCustomerIds: candidates,
      })

      if (publicClient) {
        await logWebhookAttempt(
          publicClient,
          'unmatched_inbound',
          headers,
          body,
          params,
          undefined,
          undefined,
          { unmatched_communication_id: unmatchedId, candidate_customer_ids: candidates }
        )
      }

      return NextResponse.json({ success: true, unmatchedId })
    }

    if (!customer.mobile_e164) {
      const { data: syncedCustomer, error: mobileSyncError } = await adminClient
        .from('customers')
        .update({ mobile_e164: canonicalPhone })
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

    if (isWhatsApp) {
      const { error: inboundAtError } = await adminClient
        .from('customers')
        .update({ last_whatsapp_inbound_at: new Date().toISOString() })
        .eq('id', customer.id)

      if (inboundAtError) {
        logger.warn('Failed updating customer last_whatsapp_inbound_at', {
          metadata: { customerId: customer.id, error: inboundAtError.message }
        })
      }
    }
    
    // Check for opt-out keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
    const messageUpper = messageBody.toUpperCase();
    const isOptOut = stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '));
    
    if (isOptOut) {
      const optOutPayload = isWhatsApp
        ? {
            whatsapp_opt_in: false,
            marketing_whatsapp_opt_in: false,
            whatsapp_status: 'opted_out',
            whatsapp_opted_out_at: new Date().toISOString(),
          }
        : {
            sms_opt_in: false,
            sms_status: 'opted_out',
            marketing_sms_opt_in: false,
          }

      const { data: optedOutCustomer, error: optOutError } = await adminClient
        .from('customers')
        .update(optOutPayload)
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

      try {
        await ConsentService.recordOptOut(
          customer.id,
          isWhatsApp ? 'whatsapp' : 'sms',
          isWhatsApp ? 'twilio_inbound_whatsapp' : 'twilio_inbound_sms',
          {
            captureMethod: 'inbound_keyword',
            relatedEntityType: 'message',
            metadata: {
              keyword: messageUpper.split(' ')[0],
              twilio_message_sid: messageSid,
              channel,
            },
          }
        )
      } catch (consentError) {
        logger.error('Failed to write inbound opt-out consent audit row', {
          error: consentError instanceof Error ? consentError : new Error(String(consentError)),
          metadata: {
            customerId: customer.id,
            channel,
            messageSid,
          },
        })
      }

      {
        await recordAnalyticsEventSafe(adminClient, {
          customerId: customer.id,
          eventType: isWhatsApp ? 'whatsapp_opted_out' : 'sms_opted_out',
          metadata: {
            source: isWhatsApp ? 'twilio_whatsapp_inbound_stop' : 'twilio_inbound_stop',
            keyword: messageUpper.split(' ')[0]
          }
        }, isWhatsApp ? 'whatsapp_inbound_opt_out' : 'inbound_opt_out')
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
      to_number: normalizedToNumber,
      message_type: channel,
      has_attachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : null,
    };
    
    const { data: savedMessage, error: messageError } = await adminClient
      .from('messages')
      .insert(messageData)
      .select()
      .single();
    
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

    if (!isWhatsApp) {
      try {
        const replyResult = await handleReplyToBook(normalizedFromNumber, messageBody, {
          inboundMessageId: savedMessage.id,
          inboundTwilioMessageSid: messageSid,
        });
        if (replyResult.handled && replyResult.response) {
          await sendSMS(normalizedFromNumber, replyResult.response, {
            skipQuietHours: true,
            createCustomerIfMissing: false,
            customerId: customer.id,
            metadata: {
              template_key: 'event_reply_booking_response',
              inbound_message_id: savedMessage.id,
              inbound_twilio_message_sid: messageSid,
            },
          });
        }
      } catch (replyError) {
        logger.warn('reply-to-book handler threw unexpectedly after inbound SMS logging', {
          error: replyError instanceof Error ? replyError : new Error(String(replyError)),
          metadata: { from: normalizedFromNumber, messageId: savedMessage.id },
        });
      }
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
        { customer_id: customer.id, message_id: savedMessage.id, channel }
      );
    }
    
    return NextResponse.json({ success: true, messageId: savedMessage.id });
    
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error)
    logger.error('Inbound Twilio webhook handling failed', {
      error: error instanceof Error ? error : new Error(errorMessage)
    });
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        errorMessage,
        { stack: error instanceof Error ? error.stack : undefined }
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
      .select('id, status, twilio_status, direction, customer_id, sent_at, message_type')
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
      // Skip applySmsDeliveryOutcome — this status was already processed when first received.
      // Calling it again on duplicate callbacks would inflate sms_delivery_failures counters.

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
        ...buildTwilioCostUpdate(params),
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

    if (existingMessage.message_type === 'whatsapp') {
      await applyWhatsAppDeliveryOutcome(adminClient, {
        customerId: existingMessage.customer_id,
        messageStatus,
        errorCode: errorCode || null
      })
    } else {
      await applySmsDeliveryOutcome(adminClient, {
        customerId: existingMessage.customer_id,
        messageStatus,
        errorCode: errorCode || null
      })
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
        { message_id: message?.id }
      );
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error)
    logger.error('Twilio status webhook handling failed', {
      error: error instanceof Error ? error : new Error(errorMessage)
    });
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        errorMessage,
        { stack: error instanceof Error ? error.stack : undefined }
      );
    }
    
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
