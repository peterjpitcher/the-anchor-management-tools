#!/usr/bin/env ts-node

import { createAdminClient } from '../../src/lib/supabase/server'
import { recordOutboundSmsMessage } from '../../src/lib/sms/logging'
import { logger } from '../../src/lib/logger'

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

async function backfillBatch(offset: number, limit: number) {
  const supabase = await createAdminClient()

  const { data: notifications, error } = await supabase
    .from('parking_booking_notifications')
    .select('id, booking_id, message_sid, event_type, payload')
    .eq('channel', 'sms')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    throw error
  }

  if (!notifications || notifications.length === 0) {
    return { processed: 0, inserted: 0 }
  }

  let inserted = 0

  for (const notification of notifications as ParkingNotification[]) {
    const payload = notification.payload || {}

    if (payload.message_id) {
      continue
    }

    if (!notification.message_sid || !payload.sms) {
      logger.warn('Skipping parking SMS without SID or body', {
        metadata: { id: notification.id }
      })
      continue
    }

    const { data: existing } = await supabase
      .from('messages')
      .select('id')
      .eq('twilio_message_sid', notification.message_sid)
      .maybeSingle()

    if (existing?.id) {
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
      continue
    }

    const typedBooking = booking as ParkingBooking

    if (!typedBooking.customer_id || !typedBooking.customer_mobile) {
      logger.warn('Skipping parking SMS backfill for booking without customer details', {
        metadata: { bookingId: typedBooking.id }
      })
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
        backfilled_from_notification_id: notification.id,
      }
    })

    if (messageId) {
      inserted += 1
      await supabase
        .from('parking_booking_notifications')
        .update({ payload: { ...payload, message_id: messageId } })
        .eq('id', notification.id)
    }
  }

  return { processed: notifications.length, inserted }
}

async function main() {
  const batchSize = 200
  let offset = 0
  let grandTotal = 0
  let insertedTotal = 0

  while (true) {
    const { processed, inserted } = await backfillBatch(offset, batchSize)
    if (processed === 0) {
      break
    }

    offset += processed
    grandTotal += processed
    insertedTotal += inserted

    logger.info('Parking SMS backfill progress', {
      metadata: { processed: grandTotal, inserted: insertedTotal }
    })
  }

  logger.info('Parking SMS backfill complete', {
    metadata: { processed: grandTotal, inserted: insertedTotal }
  })
}

main().catch(error => {
  logger.error('Parking SMS backfill failed', { error })
  process.exit(1)
})
