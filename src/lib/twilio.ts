import twilio from 'twilio';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';
import { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } from './env';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { recordOutboundSmsMessage } from '@/lib/sms/logging';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours';
import { shortenUrlsInSmsBody } from '@/lib/sms/link-shortening';
import { resolveSmsSuspensionReason } from '@/lib/sms/suspension';
import {
  buildSmsDedupContext,
  claimSmsIdempotency,
  evaluateSmsSafetyLimits,
  releaseSmsIdempotencyClaim
} from '@/lib/sms/safety';

const accountSid = env.TWILIO_ACCOUNT_SID;
const authToken = env.TWILIO_AUTH_TOKEN;
const fromNumber = env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

let cachedTwilioClient: ReturnType<typeof twilio> | null = null;

function getTwilioClient() {
  if (!accountSid || !authToken) {
    throw new Error('SMS not configured');
  }

  if (!cachedTwilioClient) {
    cachedTwilioClient = twilio(accountSid, authToken);
  }

  return cachedTwilioClient;
}

export type SendSMSOptions = {
  customerId?: string;
  metadata?: Record<string, unknown>;
  createCustomerIfMissing?: boolean; // Default true
  skipQuietHours?: boolean;
  skipSafetyGuards?: boolean;
  customerFallback?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

const TWILIO_SCHEDULE_MIN_DELAY_MS = 15 * 60 * 1000;

async function resolveCustomerIdIfNeeded(
  to: string,
  options: SendSMSOptions
): Promise<string | undefined> {
  if (options.customerId) {
    return options.customerId;
  }

  if (options.createCustomerIfMissing === false) {
    return undefined;
  }

  const supabase = createAdminClient();
  const { customerId: resolvedId } = await ensureCustomerForPhone(
    supabase,
    to,
    options.customerFallback
  );

  return resolvedId ?? undefined;
}

async function isCustomerSmsSendAllowed(customerId: string): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data: customer, error } = await supabase
      .from('customers')
      .select('sms_status')
      .eq('id', customerId)
      .maybeSingle();

    if (error || !customer) {
      return true;
    }

    return customer.sms_status === null || customer.sms_status === 'active';
  } catch {
    return true;
  }
}

function canUseTwilioScheduling(delayMs: number): boolean {
  return Boolean(messagingServiceSid) && delayMs >= TWILIO_SCHEDULE_MIN_DELAY_MS;
}

export const sendSMS = async (to: string, body: string, options: SendSMSOptions = {}) => {
  const suspensionReason = resolveSmsSuspensionReason({
    suspendAllSms: env.SUSPEND_ALL_SMS,
    suspendEventSms: env.SUSPEND_EVENT_SMS,
    metadata: options.metadata
  });
  if (suspensionReason) {
    logger.error('Outbound SMS suppressed by suspension flag.', {
      metadata: {
        to,
        suspensionReason,
        templateKey: (options.metadata as Record<string, unknown> | undefined)?.template_key
      }
    });
    return {
      success: false,
      error: suspensionReason === 'all_sms'
        ? 'SMS sending is temporarily paused'
        : 'Event messaging is temporarily paused'
    };
  }

  const resolvedCustomerId = await resolveCustomerIdIfNeeded(to, options);
  if (resolvedCustomerId) {
    const allowed = await isCustomerSmsSendAllowed(resolvedCustomerId);
    if (!allowed) {
      return {
        success: false,
        error: 'This number is not eligible to receive SMS messages'
      };
    }
  }

  const supabase = createAdminClient();
  const shouldApplySafetyGuards = options.skipSafetyGuards !== true;
  const dedupContext = shouldApplySafetyGuards
    ? buildSmsDedupContext({
        to,
        customerId: resolvedCustomerId ?? options.customerId ?? null,
        body,
        metadata: options.metadata
      })
    : null;
  let claimedDedupContext = false;

  if (shouldApplySafetyGuards) {
    const safetyLimits = await evaluateSmsSafetyLimits(supabase, {
      to,
      customerId: resolvedCustomerId ?? options.customerId ?? null
    });

    if (!safetyLimits.allowed) {
      logger.error('Outbound SMS blocked by safety limits', {
        metadata: {
          to,
          code: safetyLimits.code,
          reason: safetyLimits.reason,
          metrics: safetyLimits.metrics
        }
      });
      return {
        success: false,
        error: 'SMS sending paused by safety guard',
        code: safetyLimits.code
      };
    }
  }

  if (dedupContext) {
    const claimResult = await claimSmsIdempotency(supabase, dedupContext);
    if (claimResult === 'duplicate') {
      logger.warn('Suppressed duplicate SMS send attempt', {
        metadata: {
          to,
          templateKey: (options.metadata as Record<string, unknown> | undefined)?.template_key
        }
      });
      return {
        success: true,
        sid: null,
        fromNumber: null,
        status: 'suppressed_duplicate',
        messageId: null,
        customerId: resolvedCustomerId ?? options.customerId,
        suppressed: true,
        suppressionReason: 'duplicate'
      };
    }

    if (claimResult === 'conflict') {
      logger.error('SMS send blocked by idempotency conflict', {
        metadata: {
          to,
          templateKey: (options.metadata as Record<string, unknown> | undefined)?.template_key
        }
      });
      return {
        success: false,
        error: 'SMS blocked by idempotency safety guard',
        code: 'idempotency_conflict'
      };
    }

    claimedDedupContext = claimResult === 'claimed';
  }

  let smsBody = body;
  try {
    smsBody = await shortenUrlsInSmsBody(body);
  } catch (shortenError: unknown) {
    logger.warn('Failed to shorten URLs in SMS body; sending original content', {
      error: shortenError instanceof Error ? shortenError : new Error(String(shortenError)),
      metadata: { to }
    });
  }

  if (!options.skipQuietHours) {
    const quietHoursState = evaluateSmsQuietHours();

    if (quietHoursState.inQuietHours) {
      const scheduledFor = quietHoursState.nextAllowedSendAt;
      const delayMs = Math.max(1000, scheduledFor.getTime() - Date.now());

      if (!canUseTwilioScheduling(delayMs)) {
        try {
          const customerId = resolvedCustomerId;

          if (!customerId) {
            if (claimedDedupContext && dedupContext) {
              await releaseSmsIdempotencyClaim(supabase, dedupContext);
            }
            logger.error('Failed to defer SMS during quiet hours due to missing customer context', {
              metadata: { to, scheduledFor: scheduledFor.toISOString() }
            });
            return {
              success: false,
              error: 'Failed to schedule message for delivery'
            };
          }

          const { jobQueue } = await import('@/lib/unified-job-queue');
          const enqueueResult = await jobQueue.enqueue('send_sms', {
            to,
            message: smsBody,
            customerId,
            metadata: options.metadata
          }, {
            delay: delayMs
          });

          if (!enqueueResult.success) {
            if (claimedDedupContext && dedupContext) {
              await releaseSmsIdempotencyClaim(supabase, dedupContext);
            }
            logger.error('Failed to defer SMS job during quiet hours', {
              metadata: { to, scheduledFor: scheduledFor.toISOString(), error: enqueueResult.error }
            });
            return {
              success: false,
              error: 'Failed to schedule message for delivery'
            };
          }

          logger.info('Deferred SMS to respect quiet hours', {
            metadata: {
              to,
              scheduledFor: scheduledFor.toISOString(),
              timezone: quietHoursState.timezone,
              jobId: enqueueResult.jobId
            }
          });

          return {
            success: true,
            sid: null,
            fromNumber: null,
            status: 'scheduled',
            messageId: null,
            customerId,
            scheduledFor: scheduledFor.toISOString(),
            deferred: true,
            deferredBy: 'job_queue'
          };
        } catch (deferError: unknown) {
          if (claimedDedupContext && dedupContext) {
            await releaseSmsIdempotencyClaim(supabase, dedupContext);
          }
          logger.error('Unexpected error deferring SMS during quiet hours', {
            error: deferError instanceof Error ? deferError : new Error(String(deferError)),
            metadata: { to, scheduledFor: scheduledFor.toISOString() }
          });
          return {
            success: false,
            error: 'Failed to schedule message for delivery'
          };
        }
      }
    }
  }

  try {
    const quietHoursState = options.skipQuietHours ? null : evaluateSmsQuietHours();
    const shouldScheduleWithTwilio = Boolean(
      quietHoursState?.inQuietHours && canUseTwilioScheduling(quietHoursState.nextAllowedSendAt.getTime() - Date.now())
    );

    // Build message parameters
    const messageParams: any = {
      body: smsBody,
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

    if (shouldScheduleWithTwilio && quietHoursState) {
      messageParams.scheduleType = 'fixed';
      messageParams.sendAt = quietHoursState.nextAllowedSendAt.toISOString();
    }

    // Send SMS with retry logic
    const message = await retry(
      async () => {
        const client = getTwilioClient();
        return await client.messages.create(messageParams);
      },
      {
        ...RetryConfigs.sms,
        onRetry: (error, attempt) => {
          logger.warn(`SMS send retry attempt ${attempt}`, {
            error,
            metadata: { to, bodyLength: smsBody.length }
          });
        }
      }
    );
    
    const segments = Math.ceil(smsBody.length / 160);

    logger.info('SMS sent successfully', {
      metadata: { 
        to, 
        messageSid: message.sid,
        segments
      }
    });

    // AUTOMATIC LOGGING
    let messageId: string | null = null;
    let usedCustomerId: string | undefined = resolvedCustomerId ?? options.customerId;

    try {
      // If no customerId, try to resolve/create
      if (!usedCustomerId && options.createCustomerIfMissing !== false) {
        const { customerId: resolvedId } = await ensureCustomerForPhone(
          supabase,
          to,
          options.customerFallback
        );
        usedCustomerId = resolvedId ?? undefined;
      }

      if (usedCustomerId) {
          const metadata = shouldScheduleWithTwilio
            ? {
                ...(options.metadata ?? {}),
                quiet_hours_deferred: true,
                scheduled_for: quietHoursState?.nextAllowedSendAt.toISOString() ?? null
              }
            : options.metadata;
          messageId = await recordOutboundSmsMessage({
          supabase,
          customerId: usedCustomerId,
          to,
          body: smsBody,
          sid: message.sid,
          fromNumber: message.from ?? fromNumber ?? null,
          status: message.status ?? 'queued',
          twilioStatus: message.status ?? 'queued',
          metadata,
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
      customerId: usedCustomerId,
      scheduledFor: shouldScheduleWithTwilio ? quietHoursState?.nextAllowedSendAt.toISOString() : undefined,
      deferred: shouldScheduleWithTwilio,
      deferredBy: shouldScheduleWithTwilio ? 'twilio' : undefined
    };
  } catch (error: any) {
    if (claimedDedupContext && dedupContext) {
      await releaseSmsIdempotencyClaim(supabase, dedupContext);
    }
    logger.error('Failed to send SMS after retries', {
      error,
      metadata: { to, errorCode: error.code }
    });

    // Record failed attempt so downstream logic can enforce failure limits
    try {
      const failureSid = `local-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await recordOutboundSmsMessage({
        to,
        body: smsBody,
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
