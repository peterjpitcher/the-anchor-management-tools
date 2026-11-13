import { describe, expect, it } from 'vitest'
import {
  PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH,
  PRIVATE_BOOKING_CANCELLATION_REASONS,
  privateBookingCancellationReasonLabel,
  resolvePrivateBookingCancellationReason,
} from '@/lib/private-bookings/cancellation-reasons'

describe('private booking cancellation reasons', () => {
  it('holds the owner\'s list, with only "other" needing a note', () => {
    expect(PRIVATE_BOOKING_CANCELLATION_REASONS.map((reason) => reason.code)).toEqual([
      'date_unavailable',
      'price',
      'group_too_big',
      'no_reply',
      'chose_elsewhere',
      'duplicate_or_test',
      'other',
    ])
    expect(PRIVATE_BOOKING_CANCELLATION_REASONS.filter((reason) => reason.needsNote).map((reason) => reason.code)).toEqual(['other'])
  })

  it('stores the code alone, or the code and a tidied note', () => {
    expect(resolvePrivateBookingCancellationReason({ code: 'no_reply' })).toEqual({ ok: true, stored: 'no_reply' })
    expect(resolvePrivateBookingCancellationReason({ code: 'no_reply', note: '  chased  twice\n by email ' })).toEqual({
      ok: true,
      stored: 'no_reply: chased twice by email',
    })
  })

  it('cuts a long note to the limit', () => {
    const result = resolvePrivateBookingCancellationReason({ code: 'other', note: 'x'.repeat(1000) })
    expect(result).toEqual({ ok: true, stored: `other: ${'x'.repeat(PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH)}` })
  })

  it.each([undefined, null, '', 'Cancelled by staff', {}, { code: 'nope' }, { note: 'only a note' }])(
    'refuses %j as no reason',
    (input) => {
      expect(resolvePrivateBookingCancellationReason(input)).toEqual({
        ok: false,
        error: 'Choose why this booking is being cancelled',
      })
    },
  )

  it('refuses "other" without a note', () => {
    expect(resolvePrivateBookingCancellationReason({ code: 'other', note: ' ' })).toEqual({
      ok: false,
      error: 'Add a short note saying why this booking is being cancelled',
    })
  })

  it('labels a stored value, and leaves older wording as it was written', () => {
    expect(privateBookingCancellationReasonLabel('chose_elsewhere')).toBe('Customer chose somewhere else')
    expect(privateBookingCancellationReasonLabel('other: Venue flooded')).toBe('Other: Venue flooded')
    expect(privateBookingCancellationReasonLabel('Deposit hold expired')).toBe('Deposit hold expired')
    expect(privateBookingCancellationReasonLabel('Cancelled by staff')).toBe('Cancelled by staff')
    expect(privateBookingCancellationReasonLabel(null)).toBeNull()
  })
})
