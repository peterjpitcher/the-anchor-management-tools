import { describe, expect, it, vi } from 'vitest'
import {
  findExistingMessageBySid,
  persistBackfilledNotificationMessageId,
  assertParkingSmsBackfillCompletedWithoutErrors,
  assertParkingSmsBackfillPayloadProcessable,
  assertParkingSmsBackfillBookingHasCustomerFields
} from '@/lib/parking-sms-backfill-safety'

function createLookupSupabaseMock(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })

  return {
    from: vi.fn((table: string) => {
      if (table !== 'messages') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return { select }
    })
  } as any
}

function createPersistSupabaseMock(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ select })
  const update = vi.fn().mockReturnValue({ eq })

  return {
    from: vi.fn((table: string) => {
      if (table !== 'parking_booking_notifications') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return { update }
    })
  } as any
}

describe('parking SMS backfill safety', () => {
  it('returns lookup error when dedupe SID query fails', async () => {
    const supabase = createLookupSupabaseMock({
      data: null,
      error: { message: 'messages lookup unavailable' }
    })

    const result = await findExistingMessageBySid(supabase, 'SM123')
    expect(result).toEqual({
      messageId: null,
      error: 'messages lookup unavailable'
    })
  })

  it('returns existing message id when SID exists', async () => {
    const supabase = createLookupSupabaseMock({
      data: { id: 'message-1' },
      error: null
    })

    const result = await findExistingMessageBySid(supabase, 'SM124')
    expect(result).toEqual({ messageId: 'message-1' })
  })

  it('fails when notification linkage update affects no rows', async () => {
    const supabase = createPersistSupabaseMock({
      data: null,
      error: null
    })

    const result = await persistBackfilledNotificationMessageId(supabase, {
      notificationId: 'notification-1',
      payload: { sms: 'hello' },
      messageId: 'message-2'
    })

    expect(result).toEqual({
      error: 'Parking SMS backfill notification update affected no rows'
    })
  })

  it('fails when notification linkage update errors', async () => {
    const supabase = createPersistSupabaseMock({
      data: null,
      error: { message: 'notification update unavailable' }
    })

    const result = await persistBackfilledNotificationMessageId(supabase, {
      notificationId: 'notification-2',
      payload: { sms: 'hello' },
      messageId: 'message-3'
    })

    expect(result).toEqual({
      error: 'notification update unavailable'
    })
  })

  it('throws when backfill run completes with processing errors', () => {
    expect(() =>
      assertParkingSmsBackfillCompletedWithoutErrors([
        {
          notificationId: 'notification-1',
          reason: 'sid_dedupe_lookup_failed:messages unavailable'
        }
      ])
    ).toThrow(
      'parking-sms-backfill completed with 1 error(s): notification-1:sid_dedupe_lookup_failed:messages unavailable'
    )
  })

  it('throws when notification payload is missing SID or SMS body', () => {
    expect(() =>
      assertParkingSmsBackfillPayloadProcessable({
        notificationId: 'notification-3',
        messageSid: null,
        smsBody: 'Hello'
      })
    ).toThrow(
      'Notification notification-3 is missing required SMS payload fields (message_sid/body)'
    )

    expect(() =>
      assertParkingSmsBackfillPayloadProcessable({
        notificationId: 'notification-4',
        messageSid: 'SM123',
        smsBody: null
      })
    ).toThrow(
      'Notification notification-4 is missing required SMS payload fields (message_sid/body)'
    )
  })

  it('throws when booking rows are missing customer linkage fields', () => {
    expect(() =>
      assertParkingSmsBackfillBookingHasCustomerFields({
        bookingId: 'booking-1',
        customerId: null,
        customerMobile: '+447700900123'
      })
    ).toThrow(
      'Parking booking booking-1 is missing required customer fields (customer_id/customer_mobile)'
    )

    expect(() =>
      assertParkingSmsBackfillBookingHasCustomerFields({
        bookingId: 'booking-2',
        customerId: 'customer-2',
        customerMobile: null
      })
    ).toThrow(
      'Parking booking booking-2 is missing required customer fields (customer_id/customer_mobile)'
    )
  })
})
