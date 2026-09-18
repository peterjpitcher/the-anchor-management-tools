import { describe, expect, it } from 'vitest'
import {
  TABLE_BOOKING_STATUS_TONE,
  getTableBookingDepositBadgeClasses,
  getTableBookingDepositState,
  getTableBookingStatusBadgeClasses,
  getTableBookingStatusBlockClasses,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'

// Owner decision D4 (18 Sep 2026): a booking's status has one colour on every screen, and the
// badge and the FOH timeline block both come from the same tone.
describe('table booking status colours', () => {
  const expected: Array<[string, string, string, string]> = [
    ['confirmed', 'primary', 'bg-primary-soft text-primary-soft-fg border-primary/20', 'border-primary/40 bg-primary/15 text-primary-soft-fg'],
    ['pending', 'primary', 'bg-primary-soft text-primary-soft-fg border-primary/20', 'border-primary/40 bg-primary/15 text-primary-soft-fg'],
    ['seated', 'success', 'bg-success-soft text-success-fg border-success-border', 'border-success/40 bg-success/15 text-success-fg'],
    ['pending_payment', 'warning', 'bg-warning-soft text-warning-fg border-warning-border', 'border-warning/40 bg-warning/15 text-warning-fg'],
    ['no_show', 'danger', 'bg-danger-soft text-danger-fg border-danger-border', 'border-danger/40 bg-danger/15 text-danger-fg'],
    ['cancelled', 'neutral', 'bg-surface-2 text-text-muted border-border', 'border-border-strong bg-surface-hover text-text-muted'],
    ['left', 'neutral', 'bg-surface-2 text-text-muted border-border', 'border-border-strong bg-surface-hover text-text-muted'],
    ['completed', 'neutral', 'bg-surface-2 text-text-muted border-border', 'border-border-strong bg-surface-hover text-text-muted'],
    ['visited_waiting_for_review', 'cat-3', 'bg-cat-3-soft text-cat-3-fg border-cat-3/20', 'border-cat-3/40 bg-cat-3/15 text-cat-3-fg'],
    ['review_clicked', 'cat-3', 'bg-cat-3-soft text-cat-3-fg border-cat-3/20', 'border-cat-3/40 bg-cat-3/15 text-cat-3-fg'],
    ['private_block', 'cat-2', 'bg-cat-2-soft text-cat-2-fg border-cat-2/20', 'border-cat-2/40 bg-cat-2/15 text-cat-2-fg'],
  ]

  it.each(expected)('%s is %s on badges and timeline blocks', (state, tone, badge, block) => {
    expect(TABLE_BOOKING_STATUS_TONE[state]).toBe(tone)
    expect(getTableBookingStatusBadgeClasses(state)).toBe(badge)
    expect(getTableBookingStatusBlockClasses(state)).toBe(block)
  })

  it('shows any other state, including a missing one or an object key, as neutral', () => {
    for (const state of ['unknown', 'something_new', '', null, undefined, 'constructor', 'toString']) {
      expect(getTableBookingStatusBadgeClasses(state)).toBe('bg-surface-2 text-text-muted border-border')
      expect(getTableBookingStatusBlockClasses(state)).toBe('border-border-strong bg-surface-hover text-text-muted')
    }
  })

  it('colours deposits by what is owed', () => {
    expect(getTableBookingDepositBadgeClasses('paid')).toBe('bg-success-soft text-success-fg border-success-border')
    expect(getTableBookingDepositBadgeClasses('pending')).toBe('bg-warning-soft text-warning-fg border-warning-border')
    expect(getTableBookingDepositBadgeClasses('required')).toBe('bg-info-soft text-info-fg border-info-border')
    expect(getTableBookingDepositBadgeClasses('waived')).toBe('bg-surface-2 text-text-muted border-border')
    expect(getTableBookingDepositBadgeClasses('none')).toBe('bg-surface-2 text-text-muted border-border')
  })
})

describe('table booking UI helpers', () => {
  it('treats confirmed bookings with pending payment as pending payment visually', () => {
    expect(
      getTableBookingVisualState({
        status: 'confirmed',
        payment_status: 'pending',
      }),
    ).toBe('pending_payment')
  })

  it('renders confirmed under-10 bookings with stale pending payment state as booked', () => {
    expect(
      getTableBookingVisualState({
        status: 'confirmed',
        payment_status: 'pending',
        party_size: 7,
        deposit_amount: null,
        deposit_waived: false,
      }),
    ).toBe('confirmed')

    const state = getTableBookingDepositState({
      status: 'confirmed',
      payment_status: 'pending',
      party_size: 8,
      deposit_amount: null,
      deposit_waived: false,
    })

    expect(state.kind).toBe('none')
    expect(state.label).toBe('No deposit')
    expect(state.amount).toBeNull()
  })

  it('keeps 15+ bookings with pending payment in outstanding deposit state', () => {
    expect(
      getTableBookingVisualState({
        status: 'confirmed',
        payment_status: 'pending',
        party_size: 16,
        deposit_amount: null,
        deposit_waived: false,
      }),
    ).toBe('pending_payment')

    const state = getTableBookingDepositState({
      status: 'confirmed',
      payment_status: 'pending',
      party_size: 16,
      deposit_amount: null,
      deposit_waived: false,
    })

    expect(state.kind).toBe('pending')
    expect(state.label).toBe('Outstanding deposit')
    expect(state.amount).toBe(160)
  })

  it('keeps terminal cancellation ahead of payment state', () => {
    expect(
      getTableBookingVisualState({
        status: 'cancelled',
        payment_status: 'pending',
      }),
    ).toBe('cancelled')
  })

  it('shows pending deposit amount from stored deposit', () => {
    const state = getTableBookingDepositState({
      status: 'pending_payment',
      payment_status: 'pending',
      party_size: 12,
      deposit_amount: 120,
      deposit_waived: false,
    })

    expect(state.kind).toBe('pending')
    expect(state.amount).toBe(120)
    expect(state.label).toBe('Outstanding deposit')
  })

  it('uses locked paid deposit amount ahead of recomputing party size', () => {
    const state = getTableBookingDepositState({
      status: 'confirmed',
      payment_status: 'completed',
      payment_method: 'paypal',
      party_size: 14,
      deposit_amount: 140,
      deposit_amount_locked: 100,
      deposit_waived: false,
    })

    expect(state.kind).toBe('paid')
    expect(state.amount).toBe(100)
    expect(state.methodLabel).toBe('PayPal')
  })
})
