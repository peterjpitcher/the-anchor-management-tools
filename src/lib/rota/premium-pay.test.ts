import {
  computeEffectiveRate,
  computeSessionPremiumPay,
  computePlannedShiftPremiumPay,
  resolveSessionPremium,
  resolveShiftWindowInstants,
  premiumLabel,
  hasPremium,
  type SessionPremium,
  type ShiftPremium,
} from './pay-calculator';

// Helper: a London wall-clock instant for a naive "yyyy-MM-ddTHH:mm" string.
// The pay helper stores/compares instants, so tests build them the same way the
// timeclock write-path will. Europe/London BST (+01:00) applies to July dates.
function at(iso: string): Date {
  // July 2026 is BST (+01:00). Express the UTC instant explicitly.
  return new Date(iso);
}

const NONE: SessionPremium = {
  rateMultiplier: null,
  rateOverride: null,
  premiumReason: null,
  premiumStartAt: null,
  premiumEndAt: null,
};

describe('computeEffectiveRate', () => {
  it('returns base when no premium', () => {
    expect(computeEffectiveRate(12, null, null)).toBe(12);
  });

  it('applies the multiplier when set', () => {
    expect(computeEffectiveRate(12, 1.5, null)).toBe(18);
    expect(computeEffectiveRate(12, 2, null)).toBe(24);
  });

  it('lets the override win over the multiplier', () => {
    expect(computeEffectiveRate(12, 1.5, 25)).toBe(25);
  });
});

describe('premiumLabel', () => {
  it('uses the reason when supplied', () => {
    expect(premiumLabel(1.5, null, 'Bank holiday', 18, 12)).toBe('Bank holiday');
  });

  it('names ×1.5 and ×2.0', () => {
    expect(premiumLabel(1.5, null, null, 18, 12)).toBe('Time and a half');
    expect(premiumLabel(2, null, null, 24, 12)).toBe('Double time');
  });

  it('derives a factor from an override', () => {
    // £24 effective on a £12 base ⇒ ×2 ⇒ Double time
    expect(premiumLabel(null, 24, null, 24, 12)).toBe('Double time');
  });

  it('falls back to Premium ×N for odd factors', () => {
    expect(premiumLabel(1.25, null, null, 15, 12)).toBe('Premium ×1.25');
  });

  it('is empty when there is no premium', () => {
    expect(premiumLabel(null, null, null, 12, 12)).toBe('');
  });
});

describe('hasPremium', () => {
  it('is false for null and empty premium', () => {
    expect(hasPremium(null)).toBe(false);
    expect(hasPremium(NONE)).toBe(false);
  });

  it('is true when multiplier or override is set', () => {
    expect(hasPremium({ rateMultiplier: 1.5, rateOverride: null })).toBe(true);
    expect(hasPremium({ rateMultiplier: null, rateOverride: 20 })).toBe(true);
  });
});

describe('computeSessionPremiumPay — no premium (unchanged behaviour)', () => {
  it('pays flat hours × base rate, identical to the pre-premium formula', () => {
    // 8 paid hours at £12 = £96 — exactly hours × rate.
    const result = computeSessionPremiumPay(
      at('2026-07-01T09:00:00Z'),
      at('2026-07-01T17:00:00Z'),
      8,
      12,
      NONE,
    );
    expect(result.pay).toBe(96);
    expect(result.premiumHours).toBe(0);
    expect(result.baseHours).toBe(8);
    expect(result.effectiveRate).toBe(12);
    expect(result.multiplier).toBe(1);
    expect(result.premiumLabel).toBe('');
    // Proof of parity with the old calculation: round(hours × rate, 2).
    expect(result.pay).toBe(Math.round(8 * 12 * 100) / 100);
  });
});

describe('computeSessionPremiumPay — whole session (window null + multiplier)', () => {
  it('pays every paid hour at the premium rate', () => {
    const premium: SessionPremium = {
      rateMultiplier: 1.5,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: null,
      premiumEndAt: null,
    };
    // 6 hours at £10 × 1.5 = £90.
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-02T00:00:00Z'),
      6,
      10,
      premium,
    );
    expect(result.baseHours).toBe(0);
    expect(result.premiumHours).toBe(6);
    expect(result.effectiveRate).toBe(15);
    expect(result.pay).toBe(90);
    expect(result.premiumLabel).toBe('Time and a half');
  });
});

describe('computeSessionPremiumPay — partial overlap window', () => {
  it('splits base and premium hours across the window boundary', () => {
    // Worked 18:00–23:00 (5h), premium ×2 from 21:00.
    // Base 18–21 = 3h × £10 = £30; premium 21–23 = 2h × £20 = £40; total £70.
    const premium: SessionPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: at('2026-07-01T21:00:00Z'),
      premiumEndAt: at('2026-07-01T23:00:00Z'),
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      5,
      10,
      premium,
    );
    expect(result.baseHours).toBe(3);
    expect(result.premiumHours).toBe(2);
    expect(result.pay).toBe(70);
  });

  it('runs an open-ended window to clock-out', () => {
    // Premium from 21:00 with no end ⇒ 21:00–23:00 = 2h premium.
    const premium: SessionPremium = {
      rateMultiplier: 1.5,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: at('2026-07-01T21:00:00Z'),
      premiumEndAt: null,
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      5,
      10,
      premium,
    );
    // Window present (start set) so not treated as whole-session.
    expect(result.premiumHours).toBe(2);
    expect(result.baseHours).toBe(3);
    expect(result.pay).toBe(Math.round((3 * 10 + 2 * 15) * 100) / 100);
    expect(result.pay).toBe(60);
  });
});

describe('computeSessionPremiumPay — after-midnight window on an overnight session', () => {
  it('applies double-time only after 00:00', () => {
    // Worked 20:00 (day 1) → 04:00 (day 2) = 8h, no break.
    // Double-time window from 00:00 → 04:00 (4h premium), 20:00–00:00 base (4h).
    // Base 4h × £11 = £44; premium 4h × £22 = £88; total £132.
    const premium: SessionPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: at('2026-07-02T00:00:00Z'),
      premiumEndAt: at('2026-07-02T04:00:00Z'),
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T20:00:00Z'),
      at('2026-07-02T04:00:00Z'),
      8,
      11,
      premium,
    );
    expect(result.baseHours).toBe(4);
    expect(result.premiumHours).toBe(4);
    expect(result.pay).toBe(132);
    expect(result.premiumLabel).toBe('Double time');
  });
});

describe('computeSessionPremiumPay — override wins over multiplier', () => {
  it('costs the premium portion at the absolute override', () => {
    // Worked 5h, premium 2h. Override £30/h regardless of the ×1.5 multiplier.
    // Base 3h × £12 = £36; premium 2h × £30 = £60; total £96.
    const premium: SessionPremium = {
      rateMultiplier: 1.5,
      rateOverride: 30,
      premiumReason: null,
      premiumStartAt: at('2026-07-01T21:00:00Z'),
      premiumEndAt: at('2026-07-01T23:00:00Z'),
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      5,
      12,
      premium,
    );
    expect(result.effectiveRate).toBe(30);
    expect(result.pay).toBe(96);
    // The override implies a ×2.5 factor over the £12 base.
    expect(result.multiplier).toBe(2.5);
  });
});

describe('computeSessionPremiumPay — break-off-base clamp', () => {
  it('takes the break off base first when the whole worked interval is premium', () => {
    // Worked 18:00–23:00 = 5h clock, 30-min break ⇒ 4.5 paid hours.
    // Premium window == whole worked interval (18:00–23:00).
    // premiumHours must clamp to paidHours (4.5), baseHours to 0 (not negative).
    const premium: SessionPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: at('2026-07-01T18:00:00Z'),
      premiumEndAt: at('2026-07-01T23:00:00Z'),
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      4.5, // paid hours after the 30-min unpaid break
      10,
      premium,
    );
    expect(result.premiumHours).toBe(4.5);
    expect(result.baseHours).toBe(0);
    expect(result.baseHours).toBeGreaterThanOrEqual(0);
    // 4.5h × £20 = £90.
    expect(result.pay).toBe(90);
  });

  it('never lets premiumHours exceed paidHours for a partial window', () => {
    // Window is wide (17:00–23:59) but paid hours are only 3 after breaks.
    const premium: SessionPremium = {
      rateMultiplier: 1.5,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: at('2026-07-01T17:00:00Z'),
      premiumEndAt: at('2026-07-01T23:59:00Z'),
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      3,
      10,
      premium,
    );
    expect(result.premiumHours).toBeLessThanOrEqual(3);
    expect(result.premiumHours).toBe(3);
    expect(result.baseHours).toBe(0);
  });
});

describe('computeSessionPremiumPay — zero and edge hours', () => {
  it('returns zero pay for zero paid hours', () => {
    const premium: SessionPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: null,
      premiumEndAt: null,
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T18:00:00Z'),
      0,
      12,
      premium,
    );
    expect(result.pay).toBe(0);
    expect(result.baseHours).toBe(0);
    expect(result.premiumHours).toBe(0);
  });

  it('clamps negative paid hours to zero', () => {
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T17:00:00Z'),
      -1,
      12,
      NONE,
    );
    expect(result.pay).toBe(0);
    expect(result.baseHours).toBe(0);
  });
});

describe('computeSessionPremiumPay — salaried / base-null-ish path', () => {
  it('produces zero cost when base rate is zero', () => {
    // Salaried staff are excluded upstream (rate resolves to null and the
    // caller skips costing). Guard the maths: a 0 base yields 0 pay and does
    // not divide-by-zero when deriving the factor.
    const premium: SessionPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartAt: null,
      premiumEndAt: null,
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-02T00:00:00Z'),
      6,
      0,
      premium,
    );
    expect(result.pay).toBe(0);
    expect(result.effectiveRate).toBe(0);
    // Falls back to the multiplier when base is 0 (can't derive from rate).
    expect(result.multiplier).toBe(2);
  });
});

describe('resolveSessionPremium — precedence', () => {
  const sessionPrem: SessionPremium = {
    rateMultiplier: 2,
    rateOverride: null,
    premiumReason: 'Session says double',
    premiumStartAt: null,
    premiumEndAt: null,
  };
  const shiftPrem: SessionPremium = {
    rateMultiplier: 1.5,
    rateOverride: null,
    premiumReason: 'Shift says time-and-a-half',
    premiumStartAt: null,
    premiumEndAt: null,
  };

  it('session premium wins over the linked shift', () => {
    expect(resolveSessionPremium(sessionPrem, shiftPrem)).toBe(sessionPrem);
  });

  it('falls back to the linked shift when the session has none', () => {
    expect(resolveSessionPremium(NONE, shiftPrem)).toBe(shiftPrem);
    expect(resolveSessionPremium(null, shiftPrem)).toBe(shiftPrem);
  });

  it('returns no premium when neither has one', () => {
    const resolved = resolveSessionPremium(null, null);
    expect(hasPremium(resolved)).toBe(false);
  });
});

describe('computePlannedShiftPremiumPay', () => {
  const noPremium: ShiftPremium = {
    rateMultiplier: null,
    rateOverride: null,
    premiumReason: null,
    premiumStartTime: null,
    premiumEndTime: null,
  };

  it('matches flat hours × rate when no premium (unchanged estimate)', () => {
    // 09:00–17:00, 60-min break ⇒ 7 paid hours × £12 = £84.
    const result = computePlannedShiftPremiumPay('2026-07-01', '09:00', '17:00', 60, 12, noPremium);
    expect(result.baseHours).toBe(7);
    expect(result.premiumHours).toBe(0);
    expect(result.pay).toBe(84);
  });

  it('applies a whole-shift premium (null window)', () => {
    // 09:00–17:00 no break ⇒ 8h × (£10 × 1.5 = £15) = £120.
    const premium: ShiftPremium = {
      rateMultiplier: 1.5,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: null,
      premiumEndTime: null,
    };
    const result = computePlannedShiftPremiumPay('2026-07-01', '09:00', '17:00', 0, 10, premium);
    expect(result.premiumHours).toBe(8);
    expect(result.baseHours).toBe(0);
    expect(result.pay).toBe(120);
  });

  it('applies an after-midnight window on an overnight planned shift', () => {
    // 20:00 → 04:00 overnight, no break ⇒ 8h.
    // Double-time from 00:00 (premium end null ⇒ to shift end 04:00).
    // Base 20:00–00:00 (4h × £11 = £44); premium 00:00–04:00 (4h × £22 = £88); £132.
    const premium: ShiftPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: '00:00',
      premiumEndTime: null,
    };
    const result = computePlannedShiftPremiumPay('2026-07-01', '20:00', '04:00', 0, 11, premium, true);
    expect(result.baseHours).toBe(4);
    expect(result.premiumHours).toBe(4);
    expect(result.pay).toBe(132);
  });

  it('detects overnight from times even when the flag is not passed', () => {
    const premium: ShiftPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: '00:00',
      premiumEndTime: '04:00',
    };
    const result = computePlannedShiftPremiumPay('2026-07-01', '20:00', '04:00', 0, 11, premium);
    expect(result.baseHours).toBe(4);
    expect(result.premiumHours).toBe(4);
    expect(result.pay).toBe(132);
  });
});

describe('resolveShiftWindowInstants — window starting exactly at shift start (overnight)', () => {
  it('keeps a premium window opening AT the shift start on day 0 (not day+1)', () => {
    // Overnight 18:00 → 02:00, premium window 18:00 → 20:00.
    // The off-by-one bug wrapped the 18:00 start to day+1, collapsing the
    // window to zero overlap. It must resolve to day-0 18:00 → day-0 20:00 (2h).
    const { startAt, premiumStartAt, premiumEndAt } = resolveShiftWindowInstants(
      '2026-07-01',
      '18:00',
      '02:00',
      true,
      '18:00',
      '20:00',
    );
    expect(premiumStartAt).not.toBeNull();
    expect(premiumEndAt).not.toBeNull();
    // Premium starts at the same instant as the shift start (day-0 18:00).
    expect(premiumStartAt!.getTime()).toBe(startAt.getTime());
    // Window is a genuine 2 hours, not zeroed.
    expect((premiumEndAt!.getTime() - premiumStartAt!.getTime()) / 3_600_000).toBe(2);
  });

  it('costs a premium window opening at the shift start as real premium hours', () => {
    // Overnight 18:00 → 02:00 (8h), ×2 premium for the first two hours.
    // Base 6h × £10 = £60; premium 2h × £20 = £40; total £100. premiumHours > 0.
    const premium: ShiftPremium = {
      rateMultiplier: 2,
      rateOverride: null,
      premiumReason: null,
      premiumStartTime: '18:00',
      premiumEndTime: '20:00',
    };
    const result = computePlannedShiftPremiumPay('2026-07-01', '18:00', '02:00', 0, 10, premium, true);
    expect(result.premiumHours).toBe(2);
    expect(result.baseHours).toBe(6);
    expect(result.pay).toBe(100);
  });
});

describe('numeric-as-string coercion (PostgREST returns numeric as strings)', () => {
  // PostgREST serialises `numeric` columns as strings. The helper must treat a
  // string "1.50" exactly like the number 1.5. Cast through unknown because the
  // public types are number|null but the runtime value can be a string.
  const asPremium = (over: {
    rateMultiplier: number | string | null;
    rateOverride: number | string | null;
    premiumReason?: string | null;
    premiumStartAt?: Date | string | null;
    premiumEndAt?: Date | string | null;
  }): SessionPremium =>
    ({
      premiumReason: null,
      premiumStartAt: null,
      premiumEndAt: null,
      ...over,
    } as unknown as SessionPremium);

  it('treats a string multiplier "1.5" like the number 1.5', () => {
    const stringResult = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-02T00:00:00Z'),
      6,
      10,
      asPremium({ rateMultiplier: '1.5', rateOverride: null }),
    );
    const numberResult = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-02T00:00:00Z'),
      6,
      10,
      asPremium({ rateMultiplier: 1.5, rateOverride: null }),
    );
    expect(stringResult.pay).toBe(numberResult.pay);
    expect(stringResult.pay).toBe(90);
    expect(stringResult.effectiveRate).toBe(15);
    expect(stringResult.premiumLabel).toBe('Time and a half');
  });

  it('treats a string multiplier "2.00" like the number 2 (label + rate)', () => {
    expect(computeEffectiveRate(12, '2.00' as unknown as number, null)).toBe(24);
    expect(premiumLabel('2.00' as unknown as number, null, null, 24, 12)).toBe('Double time');
    expect(hasPremium({ rateMultiplier: '2.00' as unknown as number, rateOverride: null })).toBe(true);
  });

  it('treats a string override "18.00" like the number 18', () => {
    const stringResult = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      5,
      10,
      asPremium({
        rateMultiplier: null,
        rateOverride: '18.00',
        premiumStartAt: at('2026-07-01T21:00:00Z'),
        premiumEndAt: at('2026-07-01T23:00:00Z'),
      }),
    );
    const numberResult = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T23:00:00Z'),
      5,
      10,
      asPremium({
        rateMultiplier: null,
        rateOverride: 18,
        premiumStartAt: at('2026-07-01T21:00:00Z'),
        premiumEndAt: at('2026-07-01T23:00:00Z'),
      }),
    );
    expect(stringResult.effectiveRate).toBe(18);
    expect(stringResult.pay).toBe(numberResult.pay);
    // Base 3h × £10 = £30; premium 2h × £18 = £36; total £66.
    expect(stringResult.pay).toBe(66);
  });

  it('treats empty-string and NaN premium fields as no premium', () => {
    expect(hasPremium({ rateMultiplier: '' as unknown as number, rateOverride: null })).toBe(false);
    expect(hasPremium({ rateMultiplier: 'not-a-number' as unknown as number, rateOverride: null })).toBe(false);
    expect(computeEffectiveRate(12, '' as unknown as number, null)).toBe(12);
  });
});

describe('override at the £100/hr cap boundary', () => {
  it('costs a £100 override exactly at the boundary', () => {
    // Whole 4-hour session at the £100 override ⇒ £400.
    const premium: SessionPremium = {
      rateMultiplier: null,
      rateOverride: 100,
      premiumReason: null,
      premiumStartAt: null,
      premiumEndAt: null,
    };
    const result = computeSessionPremiumPay(
      at('2026-07-01T18:00:00Z'),
      at('2026-07-01T22:00:00Z'),
      4,
      10,
      premium,
    );
    expect(result.effectiveRate).toBe(100);
    expect(result.pay).toBe(400);
    // £100 over a £10 base ⇒ ×10 factor.
    expect(result.multiplier).toBe(10);
    expect(result.premiumLabel).toBe('Premium ×10');
  });
});

describe('resolveShiftWindowInstants', () => {
  it('places an after-midnight window on the following day for an overnight shift', () => {
    const { startAt, endAt, premiumStartAt, premiumEndAt } = resolveShiftWindowInstants(
      '2026-07-01',
      '20:00',
      '04:00',
      true,
      '00:00',
      '04:00',
    );
    // Shift starts on the 1st, ends on the 2nd.
    expect(startAt.getTime()).toBeLessThan(endAt.getTime());
    // Premium window sits between start and end.
    expect(premiumStartAt).not.toBeNull();
    expect(premiumEndAt).not.toBeNull();
    expect(premiumStartAt!.getTime()).toBeGreaterThanOrEqual(startAt.getTime());
    expect(premiumEndAt!.getTime()).toBeLessThanOrEqual(endAt.getTime());
    // 8-hour shift.
    expect((endAt.getTime() - startAt.getTime()) / 3_600_000).toBe(8);
    // 4-hour premium window.
    expect((premiumEndAt!.getTime() - premiumStartAt!.getTime()) / 3_600_000).toBe(4);
  });

  it('returns null premium instants when no window is given', () => {
    const { premiumStartAt, premiumEndAt } = resolveShiftWindowInstants(
      '2026-07-01',
      '09:00',
      '17:00',
      false,
      null,
      null,
    );
    expect(premiumStartAt).toBeNull();
    expect(premiumEndAt).toBeNull();
  });
});
