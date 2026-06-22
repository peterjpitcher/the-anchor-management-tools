import twilio from 'twilio';
import { createHash } from 'crypto';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';
import { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } from './env';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { recordOutboundMessage, recordOutboundSmsMessage } from '@/lib/sms/logging';
import { resolveSmsSuspensionReason } from '@/lib/sms/suspension';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours';
import { shortenUrlsInSmsBody } from '@/lib/sms/link-shortening';
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils';
import { getErrorMessage, getErrorCode } from '@/lib/errors';
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
const whatsappFromNumber = env.TWILIO_WHATSAPP_FROM;
const whatsappMessagingServiceSid = env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID;

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
  skipMessageLogging?: boolean;
  // Use only for critical operational SMS. Phone ownership checks still apply.
  allowTransactionalOverride?: boolean;
  customerFallback?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

export type SendWhatsAppOptions = Omit<SendSMSOptions, 'skipQuietHours' | 'allowTransactionalOverride'> & {
  templateKey?: string
}

const TWILIO_SCHEDULE_MIN_DELAY_MS = 15 * 60 * 1000;
const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeTemplateKey(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function approvedWhatsAppTemplateKeys(): Set<string> {
  return new Set(
    (process.env.TWILIO_WHATSAPP_APPROVED_TEMPLATE_KEYS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  )
}

function isRecentWhatsAppInbound(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp <= WHATSAPP_SERVICE_WINDOW_MS
}

async function resolveCustomerIdIfNeeded(
  to: string,
  options: SendSMSOptions
): Promise<{ customerId?: string; resolutionError?: string }> {
  if (options.customerId) {
    return { customerId: options.customerId };
  }

  if (options.createCustomerIfMissing === false) {
    return {};
  }

  const supabase = createAdminClient();
  const { customerId: resolvedId, resolutionError } = await ensureCustomerForPhone(
    supabase,
    to,
    options.customerFallback
  );

  if (resolutionError) {
    return { customerId: resolvedId ?? undefined, resolutionError };
  }

  return { customerId: resolvedId ?? undefined };
}

type SmsSendEligibility =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | 'customer_lookup_failed'
        | 'customer_phone_mismatch'
        | 'sms_status_blocked'
        | 'sms_opt_in_blocked'
        | 'whatsapp_template_required'
        | 'whatsapp_template_not_approved'
    }

function doesCustomerPhoneMatchTo(params: {
  customerPhones: string[]
  to: string
}): boolean {
  const standardizedTo = formatPhoneForStorage(params.to);
  const toVariants = generatePhoneVariants(standardizedTo);
  const toNumbersToMatch = toVariants.length > 0 ? toVariants : [standardizedTo];

  const customerVariants = new Set<string>();
  for (const phone of params.customerPhones) {
    for (const variant of generatePhoneVariants(phone)) {
      customerVariants.add(variant);
    }
  }

  return toNumbersToMatch.some(value => customerVariants.has(value));
}

export async function isCustomerSmsSendAllowed(
  customerId: string,
  to: string,
  options?: { allowTransactionalOverride?: boolean }
): Promise<SmsSendEligibility> {
  try {
    const supabase = createAdminClient();
    const { data: customer, error } = await supabase
      .from('customers')
      .select('sms_status, sms_opt_in, mobile_e164, mobile_number')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to load customer SMS eligibility state', {
        metadata: {
          customerId,
          error: error.message
        }
      })
      return { allowed: false, reason: 'customer_lookup_failed' };
    }

    if (!customer) {
      logger.error('Customer SMS eligibility lookup affected no rows', {
        metadata: { customerId }
      })
      return { allowed: false, reason: 'customer_lookup_failed' };
    }

    try {
      const rawPhones = [
        (customer as any)?.mobile_e164,
        (customer as any)?.mobile_number
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

      if (rawPhones.length === 0) {
        logger.error('Customer record missing phone fields; blocking SMS send', {
          metadata: { customerId }
        })
        return { allowed: false, reason: 'customer_phone_mismatch' };
      }

      if (!doesCustomerPhoneMatchTo({ customerPhones: rawPhones, to })) {
        logger.error('Customer phone does not match destination phone; blocking SMS send', {
          metadata: { customerId, to }
        })
        return { allowed: false, reason: 'customer_phone_mismatch' };
      }
    } catch (phoneMatchError: unknown) {
      logger.error('Failed to validate customer phone match while checking SMS eligibility', {
        error: phoneMatchError instanceof Error ? phoneMatchError : new Error(String(phoneMatchError)),
        metadata: { customerId, to }
      })
      return { allowed: false, reason: 'customer_phone_mismatch' };
    }

    if (options?.allowTransactionalOverride === true) {
      return { allowed: true };
    }

    if ((customer as any).sms_opt_in === false) {
      return { allowed: false, reason: 'sms_opt_in_blocked' };
    }

    if (customer.sms_status === null || customer.sms_status === 'active') {
      return { allowed: true };
    }

    return { allowed: false, reason: 'sms_status_blocked' };
  } catch (error) {
    logger.error('Unexpected failure loading customer SMS eligibility state', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId }
    })
    return { allowed: false, reason: 'customer_lookup_failed' };
  }
}

export async function isCustomerWhatsAppSendAllowed(
  customerId: string,
  to: string,
  options?: { marketing?: boolean; templateKey?: string | null }
): Promise<SmsSendEligibility> {
  try {
    const supabase = createAdminClient();
    const { data: customer, error } = await supabase
      .from('customers')
      .select('whatsapp_status, whatsapp_opt_in, marketing_whatsapp_opt_in, mobile_e164, mobile_number, last_whatsapp_inbound_at')
      .eq('id', customerId)
      .maybeSingle();

    if (error || !customer) {
      return { allowed: false, reason: 'customer_lookup_failed' };
    }

    const rawPhones = [
      (customer as any)?.mobile_e164,
      (customer as any)?.mobile_number
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (rawPhones.length === 0 || !doesCustomerPhoneMatchTo({ customerPhones: rawPhones, to })) {
      return { allowed: false, reason: 'customer_phone_mismatch' };
    }

    if ((customer as any).whatsapp_status === 'opted_out' || (customer as any).whatsapp_status === 'whatsapp_deactivated') {
      return { allowed: false, reason: 'sms_status_blocked' };
    }

    if (options?.marketing === true && (customer as any).marketing_whatsapp_opt_in !== true) {
      return { allowed: false, reason: 'sms_opt_in_blocked' };
    }

    if ((customer as any).whatsapp_opt_in !== true) {
      return { allowed: false, reason: 'sms_opt_in_blocked' };
    }

    if (!isRecentWhatsAppInbound((customer as any).last_whatsapp_inbound_at)) {
      const templateKey = normalizeTemplateKey(options?.templateKey)
      if (!templateKey) {
        return { allowed: false, reason: 'whatsapp_template_required' };
      }

      if (!approvedWhatsAppTemplateKeys().has(templateKey)) {
        return { allowed: false, reason: 'whatsapp_template_not_approved' };
      }
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'customer_lookup_failed' };
  }
}

function canUseTwilioScheduling(delayMs: number): boolean {
  return Boolean(messagingServiceSid) && delayMs >= TWILIO_SCHEDULE_MIN_DELAY_MS;
}

function buildDeferredSmsUniqueKey(params: {
  to: string
  customerId?: string
  scheduledForIso: string
  body: string
}): string {
  const normalizedTo = params.to.replace(/\s+/g, '')
  const identity = (params.customerId && params.customerId.trim()) || normalizedTo
  const bodyHash = createHash('sha256').update(params.body).digest('hex').slice(0, 24)
  return `send_sms_deferred:${identity}:${params.scheduledForIso}:${bodyHash}`
}

export const sendSMS = async (to: string, body: string, options: SendSMSOptions = {}) => {
  // Emergency kill switch — checked before any side effects (customer creation, DB writes).
  // Flags are read at call time so they also cover deferred sends replayed via the job queue.
  const suspensionReason = resolveSmsSuspensionReason({
    suspendAllSms: process.env.SUSPEND_ALL_SMS,
    suspendEventSms: process.env.SUSPEND_EVENT_SMS,
    metadata: options.metadata
  });

  if (suspensionReason) {
    // logger.warn is silent outside development; an active kill switch must show in production logs.
    console.warn(
      `Outbound SMS blocked: emergency suspension active (${suspensionReason === 'all_sms' ? 'SUSPEND_ALL_SMS' : 'SUSPEND_EVENT_SMS'})`,
      JSON.stringify({
        to,
        suspensionReason,
        templateKey: options.metadata?.template_key ?? null
      })
    );
    return {
      success: false,
      error: 'SMS sending is currently suspended',
      code: 'sms_suspended',
      suspensionReason
    };
  }

  let supabase: ReturnType<typeof createAdminClient> | null = null;
  let dedupContext: ReturnType<typeof buildSmsDedupContext> = null;
  let claimedDedupContext = false;

  try {
    const customerResolution = await resolveCustomerIdIfNeeded(to, options);
    const resolvedCustomerId = customerResolution.customerId;
    if (customerResolution.resolutionError) {
      logger.error('SMS blocked because customer resolution safety check failed', {
        metadata: {
          to,
          reason: customerResolution.resolutionError
        }
      })
      return {
        success: false,
        error: 'SMS blocked by customer safety check',
        code: 'customer_lookup_failed'
      };
    }

    if (resolvedCustomerId) {
      const eligibility = await isCustomerSmsSendAllowed(resolvedCustomerId, to, {
        allowTransactionalOverride: options.allowTransactionalOverride === true
      });
      if (!eligibility.allowed) {
        if (eligibility.reason === 'customer_lookup_failed' || eligibility.reason === 'customer_phone_mismatch') {
          return {
            success: false,
            error: 'SMS blocked by customer safety check',
            code: eligibility.reason
          };
        }

        return {
          success: false,
          error: 'This number is not eligible to receive SMS messages'
        };
      }
    }

    supabase = createAdminClient();
    const shouldApplySafetyGuards = options.skipSafetyGuards !== true;
    dedupContext = shouldApplySafetyGuards
      ? buildSmsDedupContext({
          to,
          customerId: resolvedCustomerId ?? options.customerId ?? null,
          body,
          metadata: options.metadata
        })
      : null;

    if (shouldApplySafetyGuards) {
      const safetyLimits = await evaluateSmsSafetyLimits(supabase, {
        to,
        customerId: resolvedCustomerId ?? options.customerId ?? null
      });

      if (!safetyLimits.allowed) {
        logger.warn('Outbound SMS blocked by safety limits', {
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
        logger.warn('SMS send blocked by idempotency conflict', {
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
            const uniqueKey = dedupContext?.key ?? buildDeferredSmsUniqueKey({
              to,
              customerId,
              scheduledForIso: scheduledFor.toISOString(),
              body: smsBody
            })
            const enqueueResult = await jobQueue.enqueue('send_sms', {
              to,
              message: smsBody,
              customerId,
              metadata: options.metadata
            }, {
              delay: delayMs,
              unique: uniqueKey
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

            if (claimedDedupContext && dedupContext) {
              await releaseSmsIdempotencyClaim(supabase, dedupContext);
              claimedDedupContext = false;
            }

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
      const skipMessageLogging = options.skipMessageLogging === true;

      if (skipMessageLogging) {
        return {
          success: true,
          sid: message.sid,
          fromNumber: message.from ?? null,
          status: message.status ?? 'queued',
          messageId: null,
          customerId: usedCustomerId ?? null,
          scheduledFor: shouldScheduleWithTwilio ? quietHoursState?.nextAllowedSendAt.toISOString() : undefined,
          deferred: shouldScheduleWithTwilio,
          deferredBy: shouldScheduleWithTwilio ? 'twilio' : undefined
        };
      }

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

          if (!messageId) {
            // Fail closed: safety limits depend on `messages` persistence, so treat logging failures as fatal.
            logger.error('SMS sent but failed to persist outbound message log; blocking further sends', {
              metadata: {
                to,
                sid: message.sid,
                customerId: usedCustomerId
              }
            })

            return {
              success: true,
              code: 'logging_failed',
              sid: message.sid,
              fromNumber: message.from ?? null,
              status: message.status ?? 'queued',
              messageId: null,
              customerId: usedCustomerId,
              scheduledFor: shouldScheduleWithTwilio ? quietHoursState?.nextAllowedSendAt.toISOString() : undefined,
              deferred: shouldScheduleWithTwilio,
              deferredBy: shouldScheduleWithTwilio ? 'twilio' : undefined,
              logFailure: true
            }
          }
        } else {
          // Fail closed: safety limits depend on `messages` persistence. Sending without a customer id
          // means we cannot log this outbound message at all (messages.customer_id is non-null), so
          // treat this as logging_failed to force callers (especially bulk/queue loops) to abort.
          logger.error('SMS sent but could not resolve customer for logging; blocking further sends', {
            metadata: { to, sid: message.sid }
          })

          return {
            success: true,
            code: 'logging_failed',
            sid: message.sid,
            fromNumber: message.from ?? null,
            status: message.status ?? 'queued',
            messageId: null,
            customerId: null,
            scheduledFor: shouldScheduleWithTwilio ? quietHoursState?.nextAllowedSendAt.toISOString() : undefined,
            deferred: shouldScheduleWithTwilio,
            deferredBy: shouldScheduleWithTwilio ? 'twilio' : undefined,
            logFailure: true
          }
        }
      } catch (logError: unknown) {
        const error = logError instanceof Error ? logError : new Error(String(logError));
        logger.error('Failed to automatically log outbound SMS', {
          error,
          metadata: { to, sid: message.sid }
        });

        return {
          success: true,
          code: 'logging_failed',
          sid: message.sid,
          fromNumber: message.from ?? null,
          status: message.status ?? 'queued',
          messageId: null,
          customerId: usedCustomerId ?? null,
          scheduledFor: shouldScheduleWithTwilio ? quietHoursState?.nextAllowedSendAt.toISOString() : undefined,
          deferred: shouldScheduleWithTwilio,
          deferredBy: shouldScheduleWithTwilio ? 'twilio' : undefined,
          logFailure: true
        }
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
    } catch (error: unknown) {
      if (claimedDedupContext && dedupContext) {
        await releaseSmsIdempotencyClaim(supabase, dedupContext);
      }
      const errCode = getErrorCode(error);
      logger.error('Failed to send SMS after retries', {
        error: error instanceof Error ? error : new Error(getErrorMessage(error)),
        metadata: { to, errorCode: errCode }
      });

      // Record failed attempt so downstream logic can enforce failure limits
      if (options.skipMessageLogging !== true) {
        try {
          const failureSid = `local-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const failureMessage = getErrorMessage(error)
          await recordOutboundSmsMessage({
            to,
            body: smsBody,
            sid: failureSid,
            customerId: resolvedCustomerId ?? options.customerId,
            status: 'failed',
            twilioStatus: String(errCode ?? 'failed'),
            metadata: {
              ...(options.metadata ?? {}),
              error_code: errCode !== undefined ? String(errCode) : 'failed',
              error_message: failureMessage
            }
          })
        } catch (logError: unknown) {
          logger.error('Failed to log outbound SMS failure', {
            error: logError instanceof Error ? logError : new Error(String(logError)),
            metadata: { to }
          })
        }
      }

      // Provide user-friendly error messages
      let userMessage = 'Failed to send message';
      if (errCode === 21211) {
        userMessage = 'Invalid phone number format';
      } else if (errCode === 21610) {
        userMessage = 'This number has opted out of messages';
      } else if (errCode === 20429) {
        userMessage = 'Too many messages sent. Please try again later';
      }

      return { success: false, error: userMessage, code: errCode !== undefined ? String(errCode) : undefined };
    }
  } catch (unexpectedError: unknown) {
    if (claimedDedupContext && dedupContext && supabase) {
      await releaseSmsIdempotencyClaim(supabase, dedupContext);
    }

    logger.error('Unexpected SMS pipeline failure', {
      error: unexpectedError instanceof Error ? unexpectedError : new Error(String(unexpectedError)),
      metadata: {
        to,
        templateKey: (options.metadata as Record<string, unknown> | undefined)?.template_key
      }
    })
    return {
      success: false,
      error: 'Failed to send message',
      code: 'safety_unavailable'
    }
  }
};

function withWhatsAppPrefix(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`
}

function stripWhatsAppPrefix(value: string): string {
  return value.trim().replace(/^whatsapp:/i, '')
}

export const sendWhatsApp = async (to: string, body: string, options: SendWhatsAppOptions = {}) => {
  const suspensionActive = process.env.SUSPEND_ALL_COMMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'
  if (suspensionActive) {
    return {
      success: false,
      error: 'Customer messaging is currently suspended',
      code: 'comms_suspended'
    }
  }

  const customerId = options.customerId
  if (!customerId) {
    return {
      success: false,
      error: 'WhatsApp sends require a customer id',
      code: 'customer_lookup_failed'
    }
  }

  const normalizedTo = stripWhatsAppPrefix(to)
  const templateKey = normalizeTemplateKey(options.templateKey) ?? normalizeTemplateKey(options.metadata?.template_key)
  const eligibility = await isCustomerWhatsAppSendAllowed(customerId, normalizedTo, {
    marketing: options.metadata?.marketing === true,
    templateKey
  })

  if (!eligibility.allowed) {
    return {
      success: false,
      error: 'This number is not eligible to receive WhatsApp messages',
      code: eligibility.reason
    }
  }

  const from = whatsappFromNumber ? withWhatsAppPrefix(whatsappFromNumber) : null
  if (!from && !whatsappMessagingServiceSid) {
    return {
      success: false,
      error: 'WhatsApp sender is not configured',
      code: 'whatsapp_not_configured'
    }
  }

  try {
    const client = getTwilioClient()
    const messageParams: any = {
      body,
      to: withWhatsAppPrefix(normalizedTo),
      statusCallback: TWILIO_STATUS_CALLBACK,
      statusCallbackMethod: TWILIO_STATUS_CALLBACK_METHOD,
    }

    if (whatsappMessagingServiceSid) {
      messageParams.messagingServiceSid = whatsappMessagingServiceSid
    } else {
      messageParams.from = from
    }

    const message = await retry(
      async () => client.messages.create(messageParams),
      {
        ...RetryConfigs.sms,
        onRetry: (error, attempt) => {
          logger.warn(`WhatsApp send retry attempt ${attempt}`, {
            error,
            metadata: { to: normalizedTo, bodyLength: body.length }
          })
        }
      }
    )

    const messageId = options.skipMessageLogging === true
      ? null
      : await recordOutboundMessage({
          customerId,
          to: normalizedTo,
          body,
          sid: message.sid,
          fromNumber: stripWhatsAppPrefix(String(message.from ?? whatsappFromNumber ?? '')),
          channel: 'whatsapp',
          status: message.status ?? 'queued',
          twilioStatus: message.status ?? 'queued',
          metadata: {
            ...(options.metadata ?? {}),
            template_key: templateKey
          },
          segments: 1,
          costUsd: 0
        })

    if (options.skipMessageLogging !== true && !messageId) {
      logger.error('WhatsApp sent but failed to persist outbound message log', {
        metadata: { to: normalizedTo, sid: message.sid, customerId }
      })
      return {
        success: false,
        error: 'WhatsApp message sent but logging failed',
        code: 'logging_failed',
        sid: message.sid,
        messageId: null,
        logFailure: true
      }
    }

    return {
      success: true,
      sid: message.sid,
      fromNumber: stripWhatsAppPrefix(String(message.from ?? whatsappFromNumber ?? '')),
      status: message.status ?? 'queued',
      messageId,
      customerId
    }
  } catch (error: unknown) {
    const errCode = getErrorCode(error)
    logger.error('Failed to send WhatsApp after retries', {
      error: error instanceof Error ? error : new Error(getErrorMessage(error)),
      metadata: { to: normalizedTo, errorCode: errCode }
    })

    if (options.skipMessageLogging !== true) {
      try {
        await recordOutboundMessage({
          to: normalizedTo,
          body,
          sid: `local-fail-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customerId,
          channel: 'whatsapp',
          status: 'failed',
          twilioStatus: String(errCode ?? 'failed'),
          metadata: {
            ...(options.metadata ?? {}),
            error_code: errCode !== undefined ? String(errCode) : 'failed',
            error_message: getErrorMessage(error)
          }
        })
      } catch (logError: unknown) {
        logger.error('Failed to log outbound WhatsApp failure', {
          error: logError instanceof Error ? logError : new Error(String(logError)),
          metadata: { to: normalizedTo, customerId }
        })
      }
    }

    return {
      success: false,
      error: 'Failed to send WhatsApp message',
      code: errCode !== undefined ? String(errCode) : undefined
    }
  }
}
