import { describe, it, expect } from 'vitest';
import {
  requiresDeposit,
  computeDepositAmount,
  getCanonicalDeposit,
} from '../../../src/lib/table-bookings/deposit';

describe('requiresDeposit', () => {
  it('returns false for parties under 15', () => {
    expect(requiresDeposit(1)).toBe(false);
    expect(requiresDeposit(9)).toBe(false);
    // Ten to fourteen owed a deposit until 2026-08-09 and now do not. This is the band
    // the change was made for, so it is asserted explicitly rather than left implied.
    expect(requiresDeposit(10)).toBe(false);
    expect(requiresDeposit(14)).toBe(false);
  });

  it('returns true for parties of 15 or more', () => {
    expect(requiresDeposit(15)).toBe(true);
    expect(requiresDeposit(20)).toBe(true);
  });

  it('returns false when deposit is waived even for 15+', () => {
    expect(requiresDeposit(15, { depositWaived: true })).toBe(false);
    expect(requiresDeposit(50, { depositWaived: true })).toBe(false);
  });
});

describe('computeDepositAmount', () => {
  it('returns 0 below threshold', () => {
    expect(computeDepositAmount(9)).toBe(0);
    expect(computeDepositAmount(14)).toBe(0);
  });

  it('returns party_size * 10 at and above threshold', () => {
    expect(computeDepositAmount(15)).toBe(150);
    expect(computeDepositAmount(20)).toBe(200);
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
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 16 };
    expect(getCanonicalDeposit(b)).toBe(160);
  });

  it('returns 0 fresh-compute when party size is below threshold and nothing is stored', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 4 };
    expect(getCanonicalDeposit(b)).toBe(0);
  });

  it('respects deposit_waived flag and returns 0', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 50, deposit_waived: true };
    expect(getCanonicalDeposit(b)).toBe(0);
  });

  it('charges a Christmas booking of 6 a fresh deposit of 60', () => {
    const b = {
      ...baseBooking,
      deposit_amount_locked: null,
      deposit_amount: null,
      status: 'confirmed',
      payment_status: null,
      party_size: 6,
      booking_type: 'christmas',
    };
    expect(getCanonicalDeposit(b)).toBe(60);
  });

  it('returns 0 for a waived Christmas booking of 6', () => {
    const b = {
      ...baseBooking,
      deposit_amount_locked: null,
      deposit_amount: null,
      status: 'confirmed',
      payment_status: null,
      party_size: 6,
      booking_type: 'christmas',
      deposit_waived: true,
    };
    expect(getCanonicalDeposit(b)).toBe(0);
  });

  it('leaves a regular booking of 6 at 0 when booking_type is not christmas', () => {
    const b = {
      ...baseBooking,
      deposit_amount_locked: null,
      deposit_amount: null,
      status: 'confirmed',
      payment_status: null,
      party_size: 6,
      booking_type: 'regular',
    };
    expect(getCanonicalDeposit(b)).toBe(0);
  });
});

// Christmas bookings always take a 10 pounds per person deposit, at any party
// size. Regular bookings keep the 15+ threshold. A manager waiver still wins.
describe('Christmas deposits', () => {
  it('requires a deposit for a Christmas booking of 6', () => {
    expect(requiresDeposit(6, { isChristmas: true })).toBe(true);
    expect(computeDepositAmount(6, { isChristmas: true })).toBe(60);
  });

  it('requires no deposit for a Christmas booking of 6 when waived', () => {
    expect(requiresDeposit(6, { isChristmas: true, depositWaived: true })).toBe(false);
    expect(computeDepositAmount(6, { isChristmas: true, depositWaived: true })).toBe(0);
  });

  it('still requires no deposit for a normal booking of 9', () => {
    expect(requiresDeposit(9)).toBe(false);
    expect(computeDepositAmount(9)).toBe(0);
    expect(requiresDeposit(9, { isChristmas: false })).toBe(false);
    expect(computeDepositAmount(9, { isChristmas: false })).toBe(0);
  });

  it('still requires 150 pounds for a normal booking of 15', () => {
    expect(requiresDeposit(15)).toBe(true);
    expect(computeDepositAmount(15)).toBe(150);
  });

  it('a Christmas booking of 12 still pays, where an ordinary booking of 12 no longer does', () => {
    // The two rules diverged when the threshold moved. Christmas is deliberately unchanged.
    expect(requiresDeposit(12, { isChristmas: true })).toBe(true);
    expect(computeDepositAmount(12, { isChristmas: true })).toBe(120);
    expect(requiresDeposit(12)).toBe(false);
    expect(computeDepositAmount(12)).toBe(0);
  });

  it('charges 10 pounds per person for a larger Christmas booking', () => {
    expect(computeDepositAmount(20, { isChristmas: true })).toBe(200);
  });
});
