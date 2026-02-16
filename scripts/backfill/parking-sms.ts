#!/usr/bin/env ts-node

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { recordOutboundSmsMessage } from '../../src/lib/sms/logging'
import { logger } from '../../src/lib/logger'
import {
   findExistingMessageBySid,
   persistBackfilledNotificationMessageId,
   assertParkingSmsBackfillCompletedWithoutErrors,
   assertParkingSmsBackfillPayloadProcessable,
   assertParkingSmsBackfillBookingHasCustomerFields
} from '../../src/lib/parking-sms-backfill-safety'
import {
  assertParkingSmsBackfillLimit,
  assertParkingSmsBackfillMutationAllowed,
  assertParkingSmsBackfillRunEnabled,
  readParkingSmsBackfillLimit,
  readParkingSmsBackfillOffset
} from '../../src/lib/parking-sms-backfill-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type ParkingNotification = {
  id: string
  booking_id: string
  message_sid: string | null
  event_type: string
  payload: { sms?: string | null; message_id?: string | null } | null
}

type ParkingBooking = {
  id: string
  customer_id: string | null
  customer_mobile: string | null
}

async function backfillBatch(params: {
  supabase: any
  offset: number
  batchSize: number
  mutationEnabled: boolean
  remainingBackfillCap: number | null
}) {
  const supabase = params.supabase

  const { data: notifications, error } = await supabase
    .from('parking_booking_notifications')
    .select('id, booking_id, message_sid, event_type, payload')
    .eq('channel', 'sms')
    .order('created_at', { ascending: true })
    .range(params.offset, params.offset + params.batchSize - 1)

  if (error) {
    throw error
  }

  if (!notifications || notifications.length === 0) {
    return {
      processed: 0,
      attempted: 0,
      inserted: 0,
      errors: [] as Array<{ notificationId: string; reason: string }>,
      hitCap: false
    }
  }

  let attempted = 0
  let inserted = 0
  const errors: Array<{ notificationId: string; reason: string }> = []
  let hitCap = false

  for (const notification of notifications as ParkingNotification[]) {
    if (
      params.remainingBackfillCap !== null &&
      attempted >= params.remainingBackfillCap
    ) {
      hitCap = true
      break
    }

    const payload = notification.payload || {}

    if (payload.message_id) {
      continue
    }

    try {
      assertParkingSmsBackfillPayloadProcessable({
        notificationId: notification.id,
        messageSid: notification.message_sid,
        smsBody: payload.sms
      })
    } catch (payloadError) {
      const reason = payloadError instanceof Error ? payloadError.message : String(payloadError)
      logger.warn('Skipping parking SMS without SID or body', {
        metadata: { id: notification.id, reason }
      })
      errors.push({
        notificationId: notification.id,
        reason: `invalid_notification_payload:${reason}`
      })
      continue
    }

    const existingMessageCheck = await findExistingMessageBySid(supabase, notification.message_sid)
    if (existingMessageCheck.error) {
      logger.error('Failed to verify parking SMS backfill dedupe; skipping to fail closed', {
        metadata: {
          notificationId: notification.id,
          sid: notification.message_sid,
          error: existingMessageCheck.error
        }
      })
      errors.push({
        notificationId: notification.id,
        reason: `sid_dedupe_lookup_failed:${existingMessageCheck.error}`
      })
      continue
    }

    if (existingMessageCheck.messageId) {
      continue
    }

    const { data: booking, error: bookingError } = await supabase
      .from('parking_bookings')
      .select('id, customer_id, customer_mobile')
      .eq('id', notification.booking_id)
      .maybeSingle()

    if (bookingError || !booking) {
      logger.error('Unable to load parking booking for backfill', {
        error: bookingError,
        metadata: { notificationId: notification.id, bookingId: notification.booking_id }
      })
      errors.push({
        notificationId: notification.id,
        reason: bookingError?.message
          ? `booking_load_failed:${bookingError.message}`
          : 'booking_missing'
      })
      continue
    }

    const typedBooking = booking as ParkingBooking

    try {
      assertParkingSmsBackfillBookingHasCustomerFields({
        bookingId: typedBooking.id,
        customerId: typedBooking.customer_id,
        customerMobile: typedBooking.customer_mobile
      })
    } catch (bookingValidationError) {
      const reason =
        bookingValidationError instanceof Error
          ? bookingValidationError.message
          : String(bookingValidationError)
      logger.warn('Skipping parking SMS backfill for booking without customer details', {
        metadata: { bookingId: typedBooking.id, reason }
      })
      errors.push({
        notificationId: notification.id,
        reason: `booking_customer_fields_missing:${reason}`
      })
      continue
    }

    attempted += 1

    if (!params.mutationEnabled) {
      continue
    }

    const messageId = await recordOutboundSmsMessage({
      supabase,
      customerId: typedBooking.customer_id,
      to: typedBooking.customer_mobile,
      body: payload.sms,
      sid: notification.message_sid,
      metadata: {
        parking_booking_id: typedBooking.id,
        event_type: notification.event_type,
        backfilled_from_notification_id: notification.id
      }
    })

    if (messageId) {
      const persistResult = await persistBackfilledNotificationMessageId(supabase, {
        notificationId: notification.id,
        payload,
        messageId
      })

      if (persistResult.error) {
        logger.error('Failed to persist parking SMS backfill linkage', {
          metadata: {
            notificationId: notification.id,
            sid: notification.message_sid,
            messageId,
            error: persistResult.error
          }
        })
        errors.push({
          notificationId: notification.id,
          reason: `notification_linkage_persist_failed:${persistResult.error}`
        })
        continue
      }

      inserted += 1
      continue
    }

    errors.push({
      notificationId: notification.id,
      reason: 'message_log_persist_failed'
    })
  }

  return { processed: notifications.length, attempted, inserted, errors, hitCap }
}

async function main() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const mutationEnabled = confirm
  const HARD_CAP = 1000

  if (argv.includes('--help')) {
    console.log(`
parking-sms-backfill (safe by default)

Dry-run (default):
  ts-node scripts/backfill/parking-sms.ts

Mutation mode (requires multi-gating + explicit cap):
  RUN_PARKING_SMS_BACKFILL_MUTATION=true ALLOW_PARKING_SMS_BACKFILL_MUTATION=true \\
    ts-node scripts/backfill/parking-sms.ts --confirm --limit 200

Optional:
  --offset <n>         Start scanning from a specific offset (ordered by created_at)
  --limit <n>          Cap number of backfills attempted in this run (hard cap ${HARD_CAP})
`)
    return
  }

  const limit = readParkingSmsBackfillLimit(argv)
  const offset = readParkingSmsBackfillOffset(argv) ?? 0

  if (mutationEnabled) {
    assertParkingSmsBackfillRunEnabled()
    assertParkingSmsBackfillMutationAllowed()
    assertParkingSmsBackfillLimit(limit ?? 0, HARD_CAP)
  } else if (limit !== null) {
    // Even in dry-run, keep reads bounded when a limit is explicitly provided.
    assertParkingSmsBackfillLimit(limit, HARD_CAP)
  }

  const supabase = createAdminClient()

  const batchSize = 200
  let grandTotal = 0
  let attemptedTotal = 0
  let insertedTotal = 0
  const allErrors: Array<{ notificationId: string; reason: string }> = []
  const targetAttempts = mutationEnabled ? (limit as number) : limit

  while (true) {
    const remainingBackfillCap =
      targetAttempts === null ? null : Math.max(0, targetAttempts - attemptedTotal)

    if (remainingBackfillCap !== null && remainingBackfillCap === 0) {
      break
    }

    const { processed, attempted, inserted, errors, hitCap } = await backfillBatch({
      supabase,
      offset,
      batchSize,
      mutationEnabled,
      remainingBackfillCap
    })
    if (processed === 0) {
      break
    }

    offset += processed
    grandTotal += processed
    attemptedTotal += attempted
    insertedTotal += inserted
    allErrors.push(...errors)

    logger.info('Parking SMS backfill progress', {
      metadata: {
        mode: mutationEnabled ? 'mutation' : 'dry-run',
        processed: grandTotal,
        attempted: attemptedTotal,
        inserted: insertedTotal,
        errors: allErrors.length
      }
    })

    if (hitCap) {
      break
    }
  }

  assertParkingSmsBackfillCompletedWithoutErrors(allErrors)

  logger.info('Parking SMS backfill complete', {
    metadata: { processed: grandTotal, attempted: attemptedTotal, inserted: insertedTotal }
  })
}

main().catch(error => {
  logger.error('Parking SMS backfill failed', { error })
  process.exitCode = 1
})
