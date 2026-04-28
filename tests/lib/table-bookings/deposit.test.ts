import { describe, it, expect } from 'vitest';
import {
  requiresDeposit,
  computeDepositAmount,
  getCanonicalDeposit,
} from '../../../src/lib/table-bookings/deposit';

describe('requiresDeposit', () => {
  it('returns false for parties under 10', () => {
    expect(requiresDeposit(1)).toBe(false);
    expect(requiresDeposit(9)).toBe(false);
  });

  it('returns true for parties of 10 or more', () => {
    expect(requiresDeposit(10)).toBe(true);
    expect(requiresDeposit(20)).toBe(true);
  });

  it('returns false when deposit is waived even for 10+', () => {
    expect(requiresDeposit(10, { depositWaived: true })).toBe(false);
    expect(requiresDeposit(50, { depositWaived: true })).toBe(false);
  });
});

describe('computeDepositAmount', () => {
  it('returns 0 below threshold', () => {
    expect(computeDepositAmount(9)).toBe(0);
  });

  it('returns party_size * 10 at and above threshold', () => {
    expect(computeDepositAmount(10)).toBe(100);
    expect(computeDepositAmount(15)).toBe(150);
  });
});

describe('getCanonicalDeposit', () => {
  const baseBooking = {
    party_size: 12,
    deposit_amount: 120,
    deposit_amount_locked: null,
    status: 'confirmed',
    payment_status: null,
    deposit_waived: false,
  };

  it('locked amount always wins, even if other fields disagree', () => {
    const b = { ...baseBooking, deposit_amount_locked: 100, deposit_amount: 999, party_size: 12 };
    expect(getCanonicalDeposit(b)).toBe(100);
  });

  it('uses stored deposit_amount when booking is in payment-required state', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: 110, status: 'pending_payment', payment_status: 'pending' };
    expect(getCanonicalDeposit(b)).toBe(110);
  });

  it('falls back to fresh compute when no locked or stored amount and no payment-required state', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 12 };
    expect(getCanonicalDeposit(b)).toBe(120);
  });

  it('returns 0 fresh-compute when party size is below threshold and nothing is stored', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 4 };
    expect(getCanonicalDeposit(b)).toBe(0);
  });

  it('respects deposit_waived flag and returns 0', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 50, deposit_waived: true };
    expect(getCanonicalDeposit(b)).toBe(0);
  });
});
