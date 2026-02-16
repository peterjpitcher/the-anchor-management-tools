import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHash } from 'crypto';
import { sendSms } from '@/app/actions/sms';
import { sendSMS } from '@/lib/twilio';
import { resolveCustomerIdForSms } from '@/lib/sms/customers';
import { ensureReplyInstruction } from '@/lib/sms/support';
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency';

export type QueueSmsInput = {
  booking_id: string;
  trigger_type: string;
  template_key: string;
  message_body: string;
  customer_phone?: string | null;
  customer_name: string;
  customer_id?: string;
  created_by?: string;
  priority?: number;
  metadata?: any;
};

const APPROVED_SMS_DISPATCH_STALE_MS = 10 * 60 * 1000;
const PRIVATE_BOOKING_SMS_QUEUE_DEDUPE_LOCK_TTL_HOURS = 0.25; // 15 minutes

const PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS = new Set<string>([
  'booking_created',
  'deposit_received',
  'final_payment_received',
  'payment_received',
  'booking_confirmed',
  'booking_completed',
  'date_changed',
  'booking_cancelled',
  'booking_expired',
  'deposit_reminder_7day',
  'deposit_reminder_1day',
  'balance_reminder_14day',
  'event_reminder_1d',
  'setup_reminder',
  'manual',
]);

function shouldAutoSendPrivateBookingSms(triggerType: string): boolean {
  return PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS.has(triggerType);
}

function buildDispatchClaim(): string {
  return `dispatching:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 10)}`;
}

function parseDispatchClaimCreatedAtMs(claim: string): number | null {
  if (!claim.startsWith('dispatching:')) {
    return null;
  }

  const match = /^dispatching:(.+):([a-z0-9]+)$/i.exec(claim);
  if (!match) {
    return null;
  }

  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCustomerResolutionCode(resolutionError?: string): string | undefined {
  if (!resolutionError) {
    return undefined;
  }

  if (
    resolutionError === 'customer_lookup_failed'
    || resolutionError === 'booking_lookup_failed'
    || resolutionError === 'unexpected_error'
  ) {
    return 'safety_unavailable';
  }

  return resolutionError;
}

export class SmsQueueService {
  private static async resolvePrivateBookingRecipientPhone(
    supabase: ReturnType<typeof createAdminClient>,
    data: QueueSmsInput
  ): Promise<{ phone: string | null; customerId?: string; error?: string; code?: string }> {
    const directPhone = data.customer_phone?.trim();
    if (directPhone) {
      return { phone: directPhone, customerId: data.customer_id };
    }

    let customerId = data.customer_id;

    const { data: booking, error: bookingError } = await supabase
      .from('private_bookings')
      .select('contact_phone, customer_id')
      .eq('id', data.booking_id)
      .maybeSingle();

    if (bookingError) {
      return {
        phone: null,
        customerId,
        error: 'Failed to resolve SMS recipient booking context',
        code: 'safety_unavailable',
      };
    }

    if (!booking) {
      return {
        phone: null,
        customerId,
        error: 'Failed to resolve SMS recipient booking context (booking missing)',
      };
    }

    const bookingPhone = booking?.contact_phone?.trim();
    if (bookingPhone) {
      return { phone: bookingPhone, customerId: customerId ?? booking?.customer_id ?? undefined };
    }

    customerId = customerId ?? booking?.customer_id ?? undefined;
    if (!customerId) {
      return { phone: null, customerId };
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('mobile_number')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) {
      return {
        phone: null,
        customerId,
        error: 'Failed to resolve SMS recipient customer context',
        code: 'safety_unavailable',
      };
    }

    const customerPhone = customer?.mobile_number?.trim();
    return { phone: customerPhone || null, customerId };
  }

  // Function to automatically send private booking SMS
  static async sendPrivateBookingSms(
    bookingId: string,
    triggerType: string,
    templateKey: string | undefined,
    phone: string,
    messageBody: string,
    customerId?: string,
    queueId?: string
  ) {
    if (!shouldAutoSendPrivateBookingSms(triggerType)) {
      console.log(`[SmsQueueService] Trigger type ${triggerType} requires manual approval`);
      return { requiresApproval: true };
    }
    
    try {
      const admin = createAdminClient();
      const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined;
      const messageWithSupport = ensureReplyInstruction(messageBody, supportPhone);
      const stage = createHash('sha256').update(messageWithSupport).digest('hex').slice(0, 16);

      const normalizedTemplateKey = templateKey?.trim().length ? templateKey.trim() : `private_booking_${triggerType}`;

      const customerResolution = await resolveCustomerIdForSms(admin as any, {
        bookingId,
        customerId,
        to: phone,
      });

      if (customerResolution.resolutionError || !customerResolution.customerId) {
        const safetyCode = normalizeCustomerResolutionCode(customerResolution.resolutionError);
        const safetyLogFailure = safetyCode === 'logging_failed';
        console.error('[SmsQueueService] Failed SMS recipient safety check', {
          bookingId,
          triggerType,
          reason: customerResolution.resolutionError || 'customer_not_found',
          code: safetyCode,
        });
        return {
          error: 'Failed SMS recipient safety check',
          ...(safetyCode ? { code: safetyCode } : {}),
          ...(safetyLogFailure ? { logFailure: true } : {}),
        };
      }

      const metadata: Record<string, unknown> = {
        private_booking_id: bookingId,
        booking_id: bookingId,
        queue_id: queueId || null,
        queue_job_id: queueId ? `private_booking_sms_queue:${queueId}` : null,
        template_key: normalizedTemplateKey,
        trigger_type: triggerType,
        stage,
        source: 'private_booking_sms_queue_auto',
      };

      const result = await sendSMS(phone, messageWithSupport, {
        customerId: customerResolution.customerId,
        metadata,
        createCustomerIfMissing: false,
      });
      const safetyCode = (result as any).code
      const safetyLogFailure =
        (result as any).logFailure === true || safetyCode === 'logging_failed'

      if (!result.success) {
        console.error('[SmsQueueService] Failed to send SMS:', result.error);
        return {
          error: result.error || 'Failed to send SMS',
          ...(safetyCode ? { code: safetyCode } : {}),
          ...(safetyLogFailure ? { logFailure: true } : {}),
        };
      }

      const deliveryState = result.suppressed
        ? 'suppressed_duplicate'
        : result.deferred
          ? 'deferred'
          : 'sent';
      
      console.log(`[SmsQueueService] Successfully sent ${triggerType} SMS for booking ${bookingId}`);
      return {
        success: true,
        sid: result.sid ?? null,
        sent: true,
        messageId: result.messageId,
        customerId: result.customerId ?? customerResolution.customerId,
        deliveryState,
        code: safetyCode,
        logFailure: safetyLogFailure
      };
    } catch (error) {
      const safetyCode = typeof (error as any)?.code === 'string' ? (error as any).code : undefined;
      const safetyLogFailure =
        (error as any)?.logFailure === true || safetyCode === 'logging_failed';
      console.error('[SmsQueueService] Exception sending SMS:', error);
      return {
        error: 'Failed to send SMS',
        ...(safetyCode ? { code: safetyCode } : {}),
        ...(safetyLogFailure ? { logFailure: true } : {}),
      };
    }
  }

  // Function to queue and auto-send private booking SMS
  static async queueAndSend(data: QueueSmsInput) {
    const supabase = createAdminClient();

    const {
      phone: resolvedPhone,
      customerId: resolvedCustomerId,
      error: phoneResolutionError,
      code: phoneResolutionCode
    } =
      await SmsQueueService.resolvePrivateBookingRecipientPhone(supabase, data);

    if (phoneResolutionError) {
      console.error('[SmsQueueService] Failed to resolve SMS recipient context', {
        bookingId: data.booking_id,
        triggerType: data.trigger_type,
        reason: phoneResolutionError,
        code: phoneResolutionCode,
      })
      return {
        error: phoneResolutionError,
        ...(phoneResolutionCode ? { code: phoneResolutionCode } : {})
      }
    }

    if (!resolvedPhone) {
      console.error('[SmsQueueService] No phone number available for SMS', {
        bookingId: data.booking_id,
        triggerType: data.trigger_type
      });
      return { error: 'No phone number available for SMS' };
    }

    const shouldAutoSend = shouldAutoSendPrivateBookingSms(data.trigger_type);
    const dispatchClaim = shouldAutoSend ? buildDispatchClaim() : null;

    const lockScope = {
      booking_id: data.booking_id,
      trigger_type: data.trigger_type,
      template_key: data.template_key,
      recipient_phone: resolvedPhone,
      message_body: data.message_body
    };
    const lockHash = computeIdempotencyRequestHash(lockScope);
    const lockKey = `sms-queue:private-booking:${lockHash}`;

    let lockClaimed = false;
    try {
      const claim = await claimIdempotencyKey(
        supabase as any,
        lockKey,
        lockHash,
        PRIVATE_BOOKING_SMS_QUEUE_DEDUPE_LOCK_TTL_HOURS
      );

      if (claim.state !== 'claimed') {
        // Another worker is currently checking/inserting this queue row. Fail closed: do not enqueue/send.
        const { data: duplicateRows, error: duplicateLookupError } = await supabase
          .from('private_booking_sms_queue')
          .select('id, status, twilio_message_sid, metadata')
          .eq('booking_id', data.booking_id)
          .eq('trigger_type', data.trigger_type)
          .eq('template_key', data.template_key)
          .eq('recipient_phone', resolvedPhone)
          .eq('message_body', data.message_body)
          .in('status', ['pending', 'approved', 'sent'])
          .limit(1);

        if (duplicateLookupError) {
          console.error(
            '[SmsQueueService] Failed to verify duplicate guard while SMS enqueue is already in progress:',
            duplicateLookupError
          );
          return { error: 'Failed SMS duplicate safety check' };
        }

        const existingDuplicate = Array.isArray(duplicateRows) ? duplicateRows[0] : undefined;
        if (existingDuplicate) {
          return {
            success: true,
            sent: false,
            suppressed: true,
            suppressionReason: 'duplicate_queue_in_progress',
            queueId: existingDuplicate.id
          };
        }

        console.error(
          '[SmsQueueService] SMS enqueue already in progress; no existing duplicate queue row found',
          {
            bookingId: data.booking_id,
            triggerType: data.trigger_type
          }
        );
        return { error: 'SMS enqueue already in progress' };
      }

      lockClaimed = true;
    } catch (lockError) {
      console.error('[SmsQueueService] Failed acquiring private-booking SMS queue insert lock:', lockError);
      return { error: 'Failed SMS duplicate safety check' };
    }

    const { data: duplicateRows, error: duplicateLookupError } = await supabase
      .from('private_booking_sms_queue')
      .select('id, status, twilio_message_sid, metadata')
      .eq('booking_id', data.booking_id)
      .eq('trigger_type', data.trigger_type)
      .eq('template_key', data.template_key)
      .eq('recipient_phone', resolvedPhone)
      .eq('message_body', data.message_body)
      .in('status', ['pending', 'approved', 'sent'])
      .limit(1);

    if (duplicateLookupError) {
      console.error('[SmsQueueService] Failed to verify duplicate guard before queue insert:', duplicateLookupError);
      if (lockClaimed) {
        try {
          await releaseIdempotencyClaim(supabase as any, lockKey, lockHash);
        } catch (releaseError) {
          console.error('[SmsQueueService] Failed to release SMS queue lock after duplicate check error:', releaseError);
        }
      }
      return { error: 'Failed SMS duplicate safety check' };
    }

    const existingDuplicate = Array.isArray(duplicateRows) ? duplicateRows[0] : undefined;
    if (existingDuplicate) {
      const { error: auditError } = await supabase.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_suppressed',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          reason: 'duplicate_queue_entry',
          existing_queue_id: existingDuplicate.id,
          recipient: resolvedPhone,
          message: data.message_body
        },
        performed_by: data.created_by || null,
      });

      if (auditError) {
        console.error('[SmsQueueService] Failed to record SMS suppression audit entry:', auditError);
      }

      if (lockClaimed) {
        try {
          await releaseIdempotencyClaim(supabase as any, lockKey, lockHash);
        } catch (releaseError) {
          console.error('[SmsQueueService] Failed to release SMS queue lock after suppression:', releaseError);
        }
      }
      return {
        success: true,
        sent: false,
        suppressed: true,
        suppressionReason: 'duplicate_queue_entry',
        queueId: existingDuplicate.id
      };
    }
    
    // Insert into queue for record keeping
    const { data: smsRecord, error: insertError } = await supabase
      .from('private_booking_sms_queue')
      .insert({
        booking_id: data.booking_id,
        trigger_type: data.trigger_type,
        template_key: data.template_key,
        scheduled_for: new Date().toISOString(),
        message_body: data.message_body,
        customer_phone: resolvedPhone,
        customer_name: data.customer_name,
        recipient_phone: resolvedPhone,
        status: 'pending',
        error_message: dispatchClaim,
        created_by: data.created_by,
        priority: data.priority || 2,
        metadata: data.metadata || {}
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[SmsQueueService] Failed to queue SMS:', insertError);
      if (lockClaimed) {
        try {
          await releaseIdempotencyClaim(supabase as any, lockKey, lockHash);
        } catch (releaseError) {
          console.error('[SmsQueueService] Failed to release SMS queue lock after insert error:', releaseError);
        }
      }
      return { error: insertError.message };
    }

    if (lockClaimed) {
      try {
        await releaseIdempotencyClaim(supabase as any, lockKey, lockHash);
      } catch (releaseError) {
        console.error('[SmsQueueService] Failed to release SMS queue lock after insert:', releaseError);
      }
    }
    
    if (!shouldAutoSend) {
      // Message requires manual approval
      // Log to audit trail
      const admin = createAdminClient();
      const { error: queuedAuditError } = await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_queued',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: resolvedPhone
        },
        performed_by: data.created_by || null,
      });
      if (queuedAuditError) {
        console.error('[SmsQueueService] Failed to write queued SMS audit log:', queuedAuditError);
      }

      return { 
        success: true, 
        requiresApproval: true,
        queueId: smsRecord.id
      };
    }

    // Auto-send for specific triggers
    const autoSendResult = await SmsQueueService.sendPrivateBookingSms(
      data.booking_id,
      data.trigger_type,
      data.template_key,
      resolvedPhone,
      data.message_body,
      resolvedCustomerId,
      smsRecord.id
    );
    
    if (autoSendResult.sent) {
      const mergedMetadata = {
        ...(smsRecord.metadata ?? {}),
        ...(autoSendResult.customerId ? { customer_id: autoSendResult.customerId } : {}),
        ...(autoSendResult.messageId ? { message_id: autoSendResult.messageId } : {}),
        ...(autoSendResult.deliveryState ? { delivery_state: autoSendResult.deliveryState } : {}),
        ...((autoSendResult as any).code ? { sms_code: (autoSendResult as any).code } : {}),
        ...((autoSendResult as any).logFailure === true ? { sms_log_failure: true } : {})
      };

      // Update the queue record with sent status
      const { data: sentQueueRow, error: sentUpdateError } = await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          twilio_message_sid: autoSendResult.sid || null,
          metadata: mergedMetadata,
          error_message: null
        })
        .eq('id', smsRecord.id)
        .select('id')
        .maybeSingle();
      if (sentUpdateError || !sentQueueRow) {
        console.error('[SmsQueueService] Failed to persist sent queue status:', sentUpdateError ?? new Error('Queue row not found'));
        return {
          // Transport send succeeded, but we cannot safely record queue state. Surface a
          // fatal safety signal so batch callers can abort downstream sends and avoid
          // retry-driven duplicate sends.
          success: true,
          sent: true,
          queueId: smsRecord.id,
          sid: autoSendResult.sid || null,
          messageId: autoSendResult.messageId,
          code: 'logging_failed',
          logFailure: true,
        };
      }
      
      // Log to audit trail
      const admin = createAdminClient();
      const { error: sentAuditError } = await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_sent',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: resolvedPhone,
          sid: autoSendResult.sid || null,
          delivery_state: autoSendResult.deliveryState || 'sent'
        },
        performed_by: data.created_by || null, // System if undefined
      });
      if (sentAuditError) {
        console.error('[SmsQueueService] Failed to write sent SMS audit log:', sentAuditError);
      }

      return { 
        success: true, 
        sent: true,
        queueId: smsRecord.id,
        sid: autoSendResult.sid || null,
        messageId: autoSendResult.messageId,
        code: (autoSendResult as any).code,
        logFailure: (autoSendResult as any).logFailure === true
      };
    } else {
      // Failed to send
      const sendError = (autoSendResult as any).error
      const { data: failedQueueRow, error: failedUpdateError } = await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'failed',
          error_message: sendError || 'Failed to send'
        })
        .eq('id', smsRecord.id)
        .select('id')
        .maybeSingle();
      if (failedUpdateError) {
        console.error('[SmsQueueService] Failed to persist failed queue status:', failedUpdateError);
        return {
          error: 'SMS failed and queue failure status update failed',
          queueId: smsRecord.id,
          originalError: sendError || 'Failed to send'
        };
      }

      if (!failedQueueRow) {
        const { data: existingFailureState, error: existingFailureStateError } = await supabase
          .from('private_booking_sms_queue')
          .select('id, status')
          .eq('id', smsRecord.id)
          .maybeSingle();

        if (existingFailureStateError) {
          console.error('[SmsQueueService] Failed to reconcile failed queue status after no-row update:', existingFailureStateError);
          return {
            error: 'SMS failed and queue failure reconciliation failed',
            queueId: smsRecord.id,
            originalError: sendError || 'Failed to send'
          };
        }

        if (existingFailureState?.status !== 'failed') {
          console.error('[SmsQueueService] Failed queue status update affected no rows and queue status is not failed', {
            queueId: smsRecord.id,
            status: existingFailureState?.status
          });
          return {
            error: 'SMS failed and queue status update affected no rows',
            queueId: smsRecord.id,
            originalError: sendError || 'Failed to send'
          };
        }
      }
      
      // Log to audit trail
      const admin = createAdminClient();
      const { error: failedAuditError } = await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_failed',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: resolvedPhone,
          error: sendError
        },
        performed_by: data.created_by || null,
      });
      if (failedAuditError) {
        console.error('[SmsQueueService] Failed to write failed SMS audit log:', failedAuditError);
      }

      return { 
        error: sendError || 'Failed to send SMS',
        queueId: smsRecord.id,
        ...((autoSendResult as any).code ? { code: (autoSendResult as any).code } : {}),
        ...((autoSendResult as any).logFailure === true ? { logFailure: true } : {})
      };
    }
  }

  static async approveSms(smsId: string, userId: string) {
    const supabase = await createClient();
    
    const { data: approvedRow, error } = await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId
      })
      .eq('id', smsId)
      .eq('status', 'pending')
      .is('error_message', null)
      .select('id')
      .maybeSingle();
    
    if (error) {
      console.error('Error approving SMS:', error);
      throw new Error(error.message || 'Failed to approve SMS');
    }
    if (!approvedRow) {
      const { data: existing, error: existingError } = await supabase
        .from('private_booking_sms_queue')
        .select('status, error_message')
        .eq('id', smsId)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message || 'Failed to check SMS state');
      }

      if (
        existing?.status === 'pending' &&
        typeof (existing as any).error_message === 'string' &&
        (existing as any).error_message.startsWith('dispatching:')
      ) {
        throw new Error('SMS dispatch already in progress for this queue item');
      }

      throw new Error('SMS not found or not pending');
    }
    
    return { success: true };
  }

  static async rejectSms(smsId: string, userId: string) {
    const supabase = await createClient();
    
    const { data: rejectedRow, error } = await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'cancelled',
        approved_at: new Date().toISOString(),
        approved_by: userId
      })
      .eq('id', smsId)
      .eq('status', 'pending')
      .is('error_message', null)
      .select('id')
      .maybeSingle();
    
    if (error) {
      console.error('Error rejecting SMS:', error);
      throw new Error(error.message || 'Failed to reject SMS');
    }
    if (!rejectedRow) {
      const { data: existing, error: existingError } = await supabase
        .from('private_booking_sms_queue')
        .select('status, error_message')
        .eq('id', smsId)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message || 'Failed to check SMS state');
      }

      if (
        existing?.status === 'pending' &&
        typeof (existing as any).error_message === 'string' &&
        (existing as any).error_message.startsWith('dispatching:')
      ) {
        throw new Error('SMS dispatch already in progress for this queue item');
      }

      throw new Error('SMS not found or not pending');
    }
    
    return { success: true };
  }

  static async sendApprovedSms(smsId: string) {
    const supabase = await createClient();
    const admin = createAdminClient();
    const dispatchClaim = buildDispatchClaim()

    // Atomically claim this row so only one worker can dispatch.
    const { data: claimedSms, error: claimError } = await supabase
      .from('private_booking_sms_queue')
      .update({
        error_message: dispatchClaim
      })
      .eq('id', smsId)
      .eq('status', 'approved')
      .is('error_message', null)
      .select('*')
      .maybeSingle();

    if (claimError) {
      console.error('Error claiming approved SMS for dispatch:', claimError);
      throw new Error(claimError.message || 'Failed to claim SMS dispatch');
    }

    const sms = claimedSms;

    if (!sms) {
      const { data: existing, error: existingError } = await supabase
        .from('private_booking_sms_queue')
        .select('id, status, error_message')
        .eq('id', smsId)
        .maybeSingle();

      if (existingError) {
        console.error('Error checking existing SMS state:', existingError);
        throw new Error(existingError.message || 'Failed to check SMS state');
      }

      if (existing?.status === 'sent') {
        return { success: true };
      }

      if (
        existing?.status === 'approved'
        && typeof existing.error_message === 'string'
        && existing.error_message.startsWith('dispatching:')
      ) {
        const claimCreatedAtMs = parseDispatchClaimCreatedAtMs(existing.error_message)
        const isStaleClaim = claimCreatedAtMs !== null
          && Date.now() - claimCreatedAtMs > APPROVED_SMS_DISPATCH_STALE_MS

        if (!isStaleClaim) {
          throw new Error('SMS dispatch already in progress for this queue item');
        }

        // Fail closed: do not automatically resend from a stale dispatch claim, because the previous
        // attempt may have sent successfully but failed to persist queue state.
        //
        // Instead, attempt a safe reconciliation by checking the central outbound `messages` log for
        // evidence of a prior send for this queue item.
        const { data: staleSms, error: staleSmsError } = await supabase
          .from('private_booking_sms_queue')
          .select('id, booking_id, recipient_phone, message_body, template_key, metadata')
          .eq('id', smsId)
          .maybeSingle();

        if (staleSmsError) {
          console.error('Error loading approved SMS for stale-claim reconciliation:', staleSmsError);
          throw new Error(staleSmsError.message || 'Failed to verify stale SMS dispatch state');
        }

        if (!staleSms) {
          throw new Error('SMS not found or not approved');
        }

        const queueJobId = `private_booking_sms_queue:${smsId}`
        const sentSinceIso = new Date(claimCreatedAtMs as number).toISOString()

        let evidence: { id: string; twilio_message_sid: string | null; sent_at: string | null } | null = null

        const { data: metadataEvidence, error: metadataEvidenceError } = await admin
          .from('messages')
          .select('id, twilio_message_sid, sent_at')
          // Prefer an exact queue correlation when possible.
          .contains('metadata', { queue_job_id: queueJobId } as any)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!metadataEvidenceError && metadataEvidence) {
          evidence = metadataEvidence as any
        } else {
          let fallbackQuery = admin
            .from('messages')
            .select('id, twilio_message_sid, sent_at')
            .eq('direction', 'outbound')
            .eq('message_type', 'sms')
            .eq('private_booking_id', staleSms.booking_id)
            .eq('to_number', staleSms.recipient_phone)
            .gte('sent_at', sentSinceIso)

          if (typeof staleSms.template_key === 'string' && staleSms.template_key.trim().length > 0) {
            fallbackQuery = fallbackQuery.eq('template_key', staleSms.template_key)
          }

          const { data: fallbackEvidence, error: fallbackEvidenceError } = await fallbackQuery
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (fallbackEvidenceError) {
            console.error('Error querying outbound messages during stale-claim reconciliation:', fallbackEvidenceError);
            throw new Error(fallbackEvidenceError.message || 'Failed to verify stale SMS dispatch state');
          }

          evidence = fallbackEvidence as any
        }

        if (!evidence) {
          throw new Error(
            'Stale SMS dispatch claim detected; refusing to resend automatically because prior send state cannot be verified'
          );
        }

        const reconciledMetadata = {
          ...((staleSms.metadata as any) ?? {}),
          delivery_state: 'sent',
          reconciled_from_stale_claim: true,
          message_id: evidence.id,
        };

        const { data: reconciledRow, error: reconcileError } = await supabase
          .from('private_booking_sms_queue')
          .update({
            status: 'sent',
            sent_at: evidence.sent_at || new Date().toISOString(),
            twilio_message_sid: evidence.twilio_message_sid,
            metadata: reconciledMetadata,
            error_message: null
          })
          .eq('id', smsId)
          .eq('status', 'approved')
          .eq('error_message', existing.error_message)
          .select('id')
          .maybeSingle();

        if (reconcileError) {
          console.error('Error reconciling stale SMS dispatch claim to sent status:', reconcileError);
          return { success: true, code: 'logging_failed', logFailure: true };
        }

        if (!reconciledRow) {
          const { data: postReconcileState, error: postReconcileStateError } = await supabase
            .from('private_booking_sms_queue')
            .select('status')
            .eq('id', smsId)
            .maybeSingle();

          if (postReconcileStateError) {
            console.error('Error checking SMS state after stale-claim reconciliation miss:', postReconcileStateError);
            return { success: true, code: 'logging_failed', logFailure: true };
          }

          if (postReconcileState?.status === 'sent') {
            return { success: true };
          }

          return { success: true, code: 'logging_failed', logFailure: true };
        }

        return { success: true };
      }
    }

    if (!sms) {
      throw new Error('SMS not found or not approved');
    }
    
    // Look up the booking to capture customer id for logging
    const { data: booking, error: bookingError } = await admin
      .from('private_bookings')
      .select('customer_id')
      .eq('id', sms.booking_id)
      .single();

    if (bookingError || !booking) {
      console.error('Error loading booking context for approved SMS dispatch:', bookingError)
      throw new Error('Failed to load booking context for approved SMS send')
    }

    const templateKey =
      typeof sms.template_key === 'string' && sms.template_key.trim().length > 0
        ? sms.template_key
        : undefined;
    const triggerType =
      typeof sms.trigger_type === 'string' && sms.trigger_type.trim().length > 0
        ? sms.trigger_type
        : undefined;

    // Send the SMS
    let result: Awaited<ReturnType<typeof sendSms>>
    try {
      result = await sendSms({
        to: sms.recipient_phone,
        body: sms.message_body,
        bookingId: sms.booking_id,
        customerId: booking?.customer_id || undefined,
        metadata: {
          private_booking_id: sms.booking_id,
          queue_id: smsId,
          // Keep queue correlation metadata out of the idempotency context so duplicate
          // queue rows cannot bypass distributed SMS dedupe.
          queue_job_id: `private_booking_sms_queue:${smsId}`
        },
        templateKey,
        triggerType
      });
    } catch (sendError) {
      const thrownCode = typeof (sendError as any)?.code === 'string' ? (sendError as any).code : undefined
      const thrownLogFailure =
        (sendError as any)?.logFailure === true || thrownCode === 'logging_failed'
      result = {
        error: sendError instanceof Error ? sendError.message : 'Failed to send SMS',
        ...(thrownCode ? { code: thrownCode } : {}),
        ...(thrownLogFailure ? { logFailure: true } : {})
      } as Awaited<ReturnType<typeof sendSms>>
    }
    
    if (result.error) {
      // Update status to failed
      const { data: failedRow, error: failedUpdateError } = await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString(),
          error_message: result.error
        })
        .eq('id', smsId)
        .eq('status', 'approved')
        .eq('error_message', dispatchClaim)
        .select('id')
        .maybeSingle();
      if (failedUpdateError) {
        console.error('Error updating SMS to failed status:', failedUpdateError);
      } else if (!failedRow) {
        const { data: existingFailureState } = await supabase
          .from('private_booking_sms_queue')
          .select('id, status')
          .eq('id', smsId)
          .maybeSingle();

        if (existingFailureState?.status === 'sent') {
          return { success: true };
        }
      }
      
      // Log to audit trail
      const { error: failedAuditError } = await admin.from('private_booking_audit').insert({
        booking_id: sms.booking_id,
        action: 'sms_failed',
        field_name: 'sms',
        new_value: sms.template_key,
        metadata: {
          trigger: sms.trigger_type,
          message: sms.message_body,
          recipient: sms.recipient_phone,
          error: result.error,
          queue_id: smsId
        },
        performed_by: sms.approved_by || null,
      });
      if (failedAuditError) {
        console.error('Error writing failed SMS audit log:', failedAuditError);
      }

      const sendFailureCode = typeof (result as any)?.code === 'string' ? (result as any).code : undefined
      const sendFailureLogFailure =
        (result as any)?.logFailure === true || sendFailureCode === 'logging_failed'
      const sendFailureError = new Error(result.error);
      if (sendFailureCode) {
        ;(sendFailureError as any).code = sendFailureCode
      }
      if (sendFailureLogFailure) {
        ;(sendFailureError as any).logFailure = true
      }

      throw sendFailureError;
    }
    
    // Update status to sent
    const updatedMetadata = {
      ...(sms.metadata ?? {}),
      ...(result.customerId ? { customer_id: result.customerId } : {}),
      ...(result.messageId ? { message_id: result.messageId } : {}),
      ...((result as any).code ? { sms_code: (result as any).code } : {}),
      ...((result as any).logFailure === true ? { sms_log_failure: true } : {}),
      ...(result.suppressed
        ? { delivery_state: 'suppressed_duplicate' }
        : result.deferred
          ? { delivery_state: 'deferred' }
          : { delivery_state: 'sent' })
    };

    const { data: sentRow, error: sentUpdateError } = await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        twilio_message_sid: result.sid || null,
        metadata: updatedMetadata,
        error_message: null
      })
      .eq('id', smsId)
      .eq('status', 'approved')
      .eq('error_message', dispatchClaim)
      .select('id')
      .maybeSingle();
    if (sentUpdateError) {
      console.error('Error updating SMS to sent status:', sentUpdateError);
      return { success: true, code: 'logging_failed', logFailure: true };
    }
    if (!sentRow) {
      const { data: existingSentState, error: existingSentStateError } = await supabase
        .from('private_booking_sms_queue')
        .select('id, status')
        .eq('id', smsId)
        .maybeSingle();
      if (existingSentStateError) {
        console.error('Error checking SMS state after sent-status persistence miss:', existingSentStateError);
        return { success: true, code: 'logging_failed', logFailure: true };
      }
      if (existingSentState?.status === 'sent') {
        const safetyCode = (result as any).code
        const safetyLogFailure =
          (result as any).logFailure === true || safetyCode === 'logging_failed'
        return { success: true, code: safetyCode, logFailure: safetyLogFailure };
      }
      return { success: true, code: 'logging_failed', logFailure: true };
    }
    
    // Log to audit trail
    const { error: sentAuditError } = await admin.from('private_booking_audit').insert({
      booking_id: sms.booking_id,
      action: 'sms_sent',
      field_name: 'sms',
      new_value: sms.template_key,
      metadata: {
        trigger: sms.trigger_type,
        message: sms.message_body,
        recipient: sms.recipient_phone,
        sid: result.sid || null,
        delivery_state: result.suppressed
          ? 'suppressed_duplicate'
          : result.deferred
            ? 'deferred'
            : 'sent',
        queue_id: smsId
      },
      performed_by: sms.approved_by || null,
    });
    if (sentAuditError) {
      console.error('Error writing sent SMS audit log:', sentAuditError);
    }

    const safetyCode = (result as any).code
    const safetyLogFailure =
      (result as any).logFailure === true || safetyCode === 'logging_failed'

    return { success: true, code: safetyCode, logFailure: safetyLogFailure };
  }

  static async getQueue(statusFilter?: string[]) {
    const supabase = await createClient();
    
    let query = supabase
      .from('private_booking_sms_queue')
      .select(`
        *,
        booking:private_bookings(
          id,
          customer_name,
          customer_first_name,
          customer_last_name,
          event_date,
          event_type,
          status
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter && statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching SMS queue:', error);
      throw new Error(error.message || 'Failed to fetch SMS queue');
    }

    return data;
  }
}
