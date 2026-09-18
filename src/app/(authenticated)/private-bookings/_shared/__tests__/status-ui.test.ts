import { describe, expect, it } from 'vitest'
import {
  privateBookingPaymentTextClass,
  privateBookingPaymentTone,
  privateBookingStatusBlockClasses,
  privateBookingStatusLabel,
  privateBookingStatusTone,
} from '../status-ui'

describe('private booking status badges', () => {
  it.each([
    // A draft is a hold waiting for its deposit, amber like pending payment (D4).
    ['draft', 'warning'],
    ['tentative', 'warning'],
    ['confirmed', 'primary'],
    // Finished states are quiet, as on the table booking map (owner decision D4).
    ['completed', 'neutral'],
    ['cancelled', 'neutral'],
  ])('gives %s the %s tone', (status, tone) => {
    expect(privateBookingStatusTone(status)).toBe(tone)
  })

  it('falls back to neutral for a status it does not know, including Object property names', () => {
    expect(privateBookingStatusTone('something_new')).toBe('neutral')
    expect(privateBookingStatusTone('constructor')).toBe('neutral')
    expect(privateBookingStatusTone(null)).toBe('neutral')
  })

  it('writes the status the way the bookings list does', () => {
    expect(privateBookingStatusLabel('confirmed')).toBe('Confirmed')
    expect(privateBookingStatusLabel('no_show')).toBe('No show')
    expect(privateBookingStatusLabel(undefined)).toBe('Unknown')
  })

  it('strikes through a cancelled block so it differs from a completed one, which shares its tone', () => {
    expect(privateBookingStatusBlockClasses('cancelled')).toContain('line-through')
    expect(privateBookingStatusBlockClasses('completed')).not.toContain('line-through')
    expect(privateBookingStatusBlockClasses('cancelled')).toBe(`${privateBookingStatusBlockClasses('completed')} line-through`)
    expect(privateBookingStatusBlockClasses('draft')).toContain('bg-warning-soft')
    expect(privateBookingStatusBlockClasses('confirmed')).toContain('bg-primary-soft')
  })
})

describe('private booking payment states', () => {
  it.each([
    ['deposit_due', 'warning'],
    ['deposit_to_be_confirmed', 'warning'],
    ['deposit_paid', 'success'],
    ['balance_due', 'warning'],
    ['overdue', 'danger'],
    ['paid_in_full', 'success'],
    ['partially_refunded', 'warning'],
    ['refunded', 'info'],
    ['not_required', 'neutral'],
  ] as const)('gives %s the %s tone', (state, tone) => {
    expect(privateBookingPaymentTone(state)).toBe(tone)
  })

  it('uses the readable -fg shade when a state is written as words', () => {
    expect(privateBookingPaymentTextClass('paid_in_full')).toBe('text-success-fg')
    expect(privateBookingPaymentTextClass('deposit_due')).toBe('text-warning-fg')
    expect(privateBookingPaymentTextClass('not_required')).toBe('text-text-muted')
  })
})
