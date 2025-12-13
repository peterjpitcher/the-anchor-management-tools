import twilio from 'twilio';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';
import { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } from './env';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { recordOutboundSmsMessage } from '@/lib/sms/logging';
import { createAdminClient } from '@/lib/supabase/admin';

const accountSid = env.TWILIO_ACCOUNT_SID;
const authToken = env.TWILIO_AUTH_TOKEN;
const fromNumber = env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

export const twilioClient = twilio(accountSid, authToken);

export type SendSMSOptions = {
  customerId?: string;
  metadata?: Record<string, unknown>;
  createCustomerIfMissing?: boolean; // Default true
  customerFallback?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

export const sendSMS = async (to: string, body: string, options: SendSMSOptions = {}) => {
  try {
    // Build message parameters
    const messageParams: any = {
      body,
      to,
      statusCallback: TWILIO_STATUS_CALLBACK,
      statusCallbackMethod: TWILIO_STATUS_CALLBACK_METHOD,
    };

    // Use messaging service if configured, otherwise use from number
    if (messagingServiceSid) {
      messageParams.messagingServiceSid = messagingServiceSid;
    } else {
      messageParams.from = fromNumber;
    }

    // Send SMS with retry logic
    const message = await retry(
      async () => {
        return await twilioClient.messages.create(messageParams);
      },
      {
        ...RetryConfigs.sms,
        onRetry: (error, attempt) => {
          logger.warn(`SMS send retry attempt ${attempt}`, {
            error,
            metadata: { to, bodyLength: body.length }
          });
        }
      }
    );
    
    const segments = Math.ceil(body.length / 160);

    logger.info('SMS sent successfully', {
      metadata: { 
        to, 
        messageSid: message.sid,
        segments
      }
    });

    // AUTOMATIC LOGGING
    let messageId: string | null = null;
    let usedCustomerId: string | undefined = options.customerId;

    try {
      const supabase = createAdminClient();

      // If no customerId, try to resolve/create
      if (!usedCustomerId) {
        const { customerId: resolvedId } = await ensureCustomerForPhone(
          supabase, 
          to, 
          options.customerFallback
        );
        usedCustomerId = resolvedId ?? undefined;
      }

      if (usedCustomerId) {
          messageId = await recordOutboundSmsMessage({
          supabase,
          customerId: usedCustomerId,
          to,
          body,
          sid: message.sid,
          fromNumber: message.from ?? fromNumber ?? null,
          status: message.status ?? 'queued',
          twilioStatus: message.status ?? 'queued',
          metadata: options.metadata,
          segments,
          // Approximate cost if not provided by API immediately (usually it isn't)
          costUsd: segments * 0.04 
        });
      } else {
        logger.warn('SMS sent but could not resolve customer for logging', {
            metadata: { to, sid: message.sid }
        });
      }
    } catch (logError: unknown) {
      const error = logError instanceof Error ? logError : new Error(String(logError));
      logger.error('Failed to automatically log outbound SMS', {
        error,
        metadata: { to, sid: message.sid }
      });
    }
    
    return { 
      success: true, 
      sid: message.sid, 
      fromNumber: message.from ?? null, 
      status: message.status ?? 'queued',
      messageId,
      customerId: usedCustomerId
    };
  } catch (error: any) {
    logger.error('Failed to send SMS after retries', {
      error,
      metadata: { to, errorCode: error.code }
    });

    // Record failed attempt so downstream logic can enforce failure limits
    try {
      const failureSid = `local-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await recordOutboundSmsMessage({
        to,
        body,
        sid: failureSid,
        customerId: options.customerId,
        status: 'failed',
        twilioStatus: String(error.code ?? 'failed'),
        metadata: {
          error_code: error.code,
          error_message: error.message
        }
      })
    } catch (logError: unknown) {
      logger.error('Failed to log outbound SMS failure', {
        error: logError instanceof Error ? logError : new Error(String(logError)),
        metadata: { to }
      })
    }
    
    // Provide user-friendly error messages
    let userMessage = 'Failed to send message';
    if (error.code === 21211) {
      userMessage = 'Invalid phone number format';
    } else if (error.code === 21610) {
      userMessage = 'This number has opted out of messages';
    } else if (error.code === 20429) {
      userMessage = 'Too many messages sent. Please try again later';
    }
    
    return { success: false, error: userMessage, code: error.code };
  }
};
