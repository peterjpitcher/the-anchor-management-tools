import { describe, expect, it } from 'vitest'
import {
  getTableBookingDepositState,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'

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

  it('keeps 10+ bookings with pending payment in outstanding deposit state', () => {
    expect(
      getTableBookingVisualState({
        status: 'confirmed',
        payment_status: 'pending',
        party_size: 10,
        deposit_amount: null,
        deposit_waived: false,
      }),
    ).toBe('pending_payment')

    const state = getTableBookingDepositState({
      status: 'confirmed',
      payment_status: 'pending',
      party_size: 10,
      deposit_amount: null,
      deposit_waived: false,
    })

    expect(state.kind).toBe('pending')
    expect(state.label).toBe('Outstanding deposit')
    expect(state.amount).toBe(100)
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
