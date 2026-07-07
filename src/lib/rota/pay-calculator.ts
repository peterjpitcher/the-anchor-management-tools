import { createClient } from '@/lib/supabase/server';
import { differenceInYears, parseISO } from 'date-fns';
import { parseLondonDateTimeLocal } from '@/lib/dateUtils';

/**
 * Calculates the hourly rate for a given employee on a given shift date.
 *
 * Priority:
 * 1. Employee-specific override (employee_rate_overrides) — latest effective_from <= shiftDate
 * 2. Age-band rate (pay_age_bands + pay_band_rates) — band matched to employee age on shift date
 *
 * Returns null if the employee is salaried, or if no rate can be determined.
 * Callers should surface null rates as data completeness warnings.
 */
export async function getHourlyRate(
  employeeId: string,
  shiftDate: string, // ISO date string e.g. "2026-03-01"
): Promise<{ rate: number; source: 'override' | 'age_band' } | null> {
  const supabase = await createClient();

  // 1. Check pay type
  const { data: paySettings } = await supabase
    .from('employee_pay_settings')
    .select('pay_type')
    .eq('employee_id', employeeId)
    .single();

  if (paySettings?.pay_type === 'salaried') return null;

  // 2. Check for employee-specific override
  const { data: override } = await supabase
    .from('employee_rate_overrides')
    .select('hourly_rate')
    .eq('employee_id', employeeId)
    .lte('effective_from', shiftDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();

  if (override) {
    return { rate: Number(override.hourly_rate), source: 'override' };
  }

  // 3. Determine age on shift date
  const { data: employee } = await supabase
    .from('employees')
    .select('date_of_birth')
    .eq('employee_id', employeeId)
    .single();

  if (!employee?.date_of_birth) return null;

  const ageOnShiftDate = differenceInYears(parseISO(shiftDate), parseISO(employee.date_of_birth));

  // 4. Find matching age band
  const { data: bands } = await supabase
    .from('pay_age_bands')
    .select('id, min_age, max_age')
    .eq('is_active', true);

  const matchingBand = bands?.find(band =>
    ageOnShiftDate >= band.min_age &&
    (band.max_age === null || ageOnShiftDate <= band.max_age),
  );

  if (!matchingBand) return null;

  // 5. Find latest effective rate for the band on or before shift date
  const { data: bandRate } = await supabase
    .from('pay_band_rates')
    .select('hourly_rate')
    .eq('band_id', matchingBand.id)
    .lte('effective_from', shiftDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();

  if (!bandRate) return null;

  return { rate: Number(bandRate.hourly_rate), source: 'age_band' };
}

/**
 * Calculates paid hours from start time, end time, and unpaid break minutes.
 * Handles overnight shifts (end_time < start_time).
 */
export function calculatePaidHours(
  startTime: string, // "HH:mm"
  endTime: string,   // "HH:mm"
  unpaidBreakMinutes: number,
  isOvernight = false,
): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  let endMinutes = endH * 60 + endM;

  if (isOvernight || endMinutes < startMinutes) {
    endMinutes += 24 * 60; // add a day for overnight
  }

  const grossMinutes = endMinutes - startMinutes;
  const paidMinutes = Math.max(0, grossMinutes - unpaidBreakMinutes);

  return Math.round((paidMinutes / 60) * 100) / 100; // round to 2dp
}

/**
 * Calculates paid hours from actual clock timestamps.
 * Returns null if either timestamp is missing.
 */
export function calculateActualPaidHours(
  clockInAt: string,  // ISO timestamp
  clockOutAt: string | null,
  unpaidBreakMinutes = 0,
): number | null {
  if (!clockOutAt) return null;

  const durationMs = new Date(clockOutAt).getTime() - new Date(clockInAt).getTime();
  const durationMinutes = durationMs / 1000 / 60;
  const paidMinutes = Math.max(0, durationMinutes - unpaidBreakMinutes);

  return Math.round((paidMinutes / 60) * 100) / 100;
}

export interface RateResolver {
  /** Resolve hourly rate for a specific date. Returns null if no rate found or employee is salaried. */
  resolve: (shiftDate: string) => { rate: number; source: 'override' | 'age_band' } | null;
  /** Whether the employee is salaried (no hourly rate applies) */
  isSalaried: boolean;
  /** Whether the employee has pay_type = 'hourly' (summary card should show) */
  isHourly: boolean;
}

/**
 * Pre-fetches all rate data for an employee and returns a resolver function
 * that can determine the hourly rate for any date without additional DB calls.
 *
 * Use this instead of calling getHourlyRate() in a loop.
 */
export async function getBatchHourlyRates(employeeId: string): Promise<RateResolver> {
  const supabase = await createClient();

  // Fetch employee-specific data and age bands in parallel
  // Note: pay_type default 'hourly' must match the same default in portal/shifts/page.tsx
  const [paySettingsRes, overridesRes, employeeRes, bandsRes] = await Promise.all([
    supabase
      .from('employee_pay_settings')
      .select('pay_type')
      .eq('employee_id', employeeId)
      .single(),
    supabase
      .from('employee_rate_overrides')
      .select('hourly_rate, effective_from')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false }),
    supabase
      .from('employees')
      .select('date_of_birth')
      .eq('employee_id', employeeId)
      .single(),
    supabase
      .from('pay_age_bands')
      .select('id, min_age, max_age')
      .eq('is_active', true),
  ]);

  const payType = paySettingsRes.data?.pay_type ?? 'hourly';
  const isSalaried = payType === 'salaried';
  const isHourly = payType === 'hourly';

  if (isSalaried) {
    return {
      resolve: () => null,
      isSalaried: true,
      isHourly: false,
    };
  }

  const overrides = overridesRes.data ?? [];
  const dob = employeeRes.data?.date_of_birth ?? null;
  const bands = bandsRes.data ?? [];

  // Fetch band rates only for active bands to avoid unbounded table scan
  const bandIds = bands.map(b => b.id);
  const bandRatesByBand: Map<string, Array<{ hourly_rate: number; effective_from: string }>> = new Map();
  if (bandIds.length > 0) {
    const { data: bandRatesData } = await supabase
      .from('pay_band_rates')
      .select('band_id, hourly_rate, effective_from')
      .in('band_id', bandIds)
      .order('effective_from', { ascending: false });

    // Group by band_id for unambiguous per-band lookup
    for (const r of bandRatesData ?? []) {
      const existing = bandRatesByBand.get(r.band_id);
      if (existing) {
        existing.push({ hourly_rate: Number(r.hourly_rate), effective_from: r.effective_from });
      } else {
        bandRatesByBand.set(r.band_id, [{ hourly_rate: Number(r.hourly_rate), effective_from: r.effective_from }]);
      }
    }
  }

  const resolve = (shiftDate: string): { rate: number; source: 'override' | 'age_band' } | null => {
    // 1. Check for employee-specific override
    const override = overrides.find(o => o.effective_from <= shiftDate);
    if (override) {
      return { rate: Number(override.hourly_rate), source: 'override' };
    }

    // 2. Determine age on shift date and find matching band
    if (!dob) return null;

    const ageOnShiftDate = differenceInYears(parseISO(shiftDate), parseISO(dob));

    const matchingBand = bands.find(band =>
      ageOnShiftDate >= band.min_age &&
      (band.max_age === null || ageOnShiftDate <= band.max_age),
    );

    if (!matchingBand) return null;

    // 3. Find latest effective rate for the band on or before shift date
    const rates = bandRatesByBand.get(matchingBand.id);
    if (!rates) return null;

    // Rates are already sorted by effective_from DESC, so first match is most recent
    const bandRate = rates.find(r => r.effective_from <= shiftDate);
    if (!bandRate) return null;

    return { rate: bandRate.hourly_rate, source: 'age_band' };
  };

  return { resolve, isSalaried, isHourly };
}

// ---------------------------------------------------------------------------
// Premium hourly rates (time-and-a-half / double-time / bespoke)
//
// One window-aware pay calculator, consumed by rota estimate, timeclock,
// payroll, staff portal and accountant export so they can never diverge.
// See tasks/premium-rate-spec.md §4 for the authoritative contract.
//
// Contract:
//   effectiveRate = rateOverride ?? (baseRate × (rateMultiplier ?? 1))
//   premiumHours  = min( overlap(window, workedInterval), paidHours )
//                   ; window NULL + premium set  => whole worked interval
//                   ; no premium                 => 0
//   baseHours     = paidHours − premiumHours        (break comes off BASE first)
//   pay           = round(baseHours × baseRate + premiumHours × effectiveRate, 2)
//   precedence    = session premium → linked shift premium → none (×1.0)
//   label         = premiumReason ?? (×1.5 "Time and a half"
//                                     / ×2.0 "Double time" / "Premium ×N")
// ---------------------------------------------------------------------------

/** A moment in time: an ISO/parseable string or a Date. */
export type Instant = string | Date;

/**
 * Premium as resolved for a WORKED session (paid path). The window, when set,
 * is expressed as instants so overlap across midnight is unambiguous.
 * A premium is "present" when either multiplier or override is non-null.
 */
export interface SessionPremium {
  rateMultiplier: number | null;
  rateOverride: number | null;
  premiumReason: string | null;
  /** NULL = whole session. */
  premiumStartAt: Instant | null;
  /** NULL = whole session. */
  premiumEndAt: Instant | null;
}

/**
 * Premium as stored on a PLANNED shift. The window is time-of-day, interpreted
 * on the shift date honouring is_overnight.
 */
export interface ShiftPremium {
  rateMultiplier: number | null;
  rateOverride: number | null;
  premiumReason: string | null;
  /** "HH:mm" or "HH:mm:ss". NULL = whole shift. */
  premiumStartTime: string | null;
  /** "HH:mm" or "HH:mm:ss". NULL = whole shift. */
  premiumEndTime: string | null;
}

/** Result of splitting paid hours into base + premium and costing them. */
export interface PremiumPayResult {
  /** Hours paid at the base rate. */
  baseHours: number;
  /** Hours paid at the effective (premium) rate. */
  premiumHours: number;
  /** The rate applied to premiumHours (override, else base × multiplier). */
  effectiveRate: number;
  /**
   * The multiplier of the premium portion (rateOverride ⁄ baseRate when an
   * absolute override is used, so the accountant export can show a factor).
   * 1 when there is no premium.
   */
  multiplier: number;
  /** The reason supplied by the manager, if any. */
  premiumReason: string | null;
  /** Human label for the premium, e.g. "Time and a half". Empty when none. */
  premiumLabel: string;
  /** Total pay for the session, rounded to 2dp. */
  pay: number;
}

/** Round to whole pence, matching the rounding order used everywhere else. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Round hours to 2dp, matching calculatePaidHours / calculateActualPaidHours. */
function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Coerce a premium numeric field to a usable number, or null when absent.
 *
 * PostgREST returns `numeric` columns as STRINGS, so a multiplier stored as
 * `1.50` arrives as the string "1.50" and would break `=== 1.5` comparisons and
 * silently coerce during arithmetic. This normalises every premium read: a
 * finite number (from a string or number) passes through; null/undefined/empty
 * string / NaN all collapse to null ("no premium").
 */
function toPremiumNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** True when a premium multiplier or override is set (i.e. premium is present). */
export function hasPremium(
  premium: { rateMultiplier: number | null; rateOverride: number | null } | null | undefined,
): boolean {
  if (!premium) return false;
  return toPremiumNumber(premium.rateMultiplier) != null || toPremiumNumber(premium.rateOverride) != null;
}

/**
 * The effective hourly rate for the premium portion.
 * Override wins; else base × multiplier; else base (×1.0).
 */
export function computeEffectiveRate(
  baseRate: number,
  rateMultiplier: number | null,
  rateOverride: number | null,
): number {
  const override = toPremiumNumber(rateOverride);
  if (override != null) return override;
  const multiplier = toPremiumNumber(rateMultiplier);
  return baseRate * (multiplier ?? 1);
}

/** The premium label. Reason wins; else a friendly name for the factor. */
export function premiumLabel(
  rateMultiplier: number | null,
  rateOverride: number | null,
  premiumReason: string | null,
  effectiveRate: number,
  baseRate: number,
): string {
  if (premiumReason && premiumReason.trim()) return premiumReason.trim();
  if (!hasPremium({ rateMultiplier, rateOverride })) return '';

  const override = toPremiumNumber(rateOverride);

  // Derive the factor from the multiplier, or from the override vs base rate.
  let factor = toPremiumNumber(rateMultiplier);
  if (factor == null && override != null && baseRate > 0) {
    factor = round2(effectiveRate / baseRate);
  }

  if (factor === 1.5) return 'Time and a half';
  if (factor === 2) return 'Double time';
  if (factor != null) return `Premium ×${factor}`;
  return 'Premium';
}

/**
 * Overlap between a [start, end) window and a worked [in, out) interval, in
 * milliseconds. Any missing bound clamps to the worked interval (an open window
 * end therefore runs to clock-out; an open start runs from clock-in).
 */
function overlapMs(
  windowStart: Instant | null,
  windowEnd: Instant | null,
  workedIn: Instant,
  workedOut: Instant,
): number {
  const inMs = toDate(workedIn).getTime();
  const outMs = toDate(workedOut).getTime();
  const startMs = windowStart != null ? Math.max(toDate(windowStart).getTime(), inMs) : inMs;
  const endMs = windowEnd != null ? Math.min(toDate(windowEnd).getTime(), outMs) : outMs;
  return Math.max(0, endMs - startMs);
}

/**
 * Core split-and-cost. Given the worked interval as instants, the already
 * break-adjusted paidHours, the base rate and a resolved premium, split
 * paidHours into base + premium and return the costed result.
 *
 * The premium window is measured against the FULL worked interval (clock-in →
 * clock-out); the unpaid break is then taken off BASE hours first by clamping
 * premiumHours ≤ paidHours. When a premium is set but no window is given, the
 * whole session is premium.
 */
export function computeSessionPremiumPay(
  clockIn: Instant,
  clockOut: Instant,
  paidHours: number,
  baseRate: number,
  premium: SessionPremium,
): PremiumPayResult {
  const safePaidHours = Math.max(0, paidHours);
  const effectiveRate = computeEffectiveRate(baseRate, premium.rateMultiplier, premium.rateOverride);
  const label = premiumLabel(
    premium.rateMultiplier,
    premium.rateOverride,
    premium.premiumReason,
    effectiveRate,
    baseRate,
  );

  let premiumHours = 0;
  if (hasPremium(premium)) {
    if (premium.premiumStartAt == null && premium.premiumEndAt == null) {
      // Whole session is premium.
      premiumHours = safePaidHours;
    } else {
      const workedMs = Math.max(0, toDate(clockOut).getTime() - toDate(clockIn).getTime());
      const workedHours = workedMs / 1000 / 60 / 60;
      const overlapHours = workedHours > 0
        ? roundHours((overlapMs(premium.premiumStartAt, premium.premiumEndAt, clockIn, clockOut) / 1000 / 60 / 60))
        : 0;
      // Break comes off BASE first: clamp premium to what's actually paid.
      premiumHours = Math.min(overlapHours, safePaidHours);
    }
  }

  premiumHours = roundHours(premiumHours);
  const baseHours = roundHours(Math.max(0, safePaidHours - premiumHours));
  const multiplier = baseRate > 0
    ? round2(effectiveRate / baseRate)
    : (toPremiumNumber(premium.rateMultiplier) ?? 1);
  const pay = round2(baseHours * baseRate + premiumHours * effectiveRate);

  return {
    baseHours,
    premiumHours,
    effectiveRate,
    multiplier: hasPremium(premium) ? multiplier : 1,
    premiumReason: premium.premiumReason ?? null,
    premiumLabel: label,
    pay,
  };
}

/**
 * Resolve the effective premium for a worked session from the precedence
 * chain: session's own premium → the linked shift's premium → none (×1.0).
 *
 * The linked shift stores a time-of-day window; converting it to instants is
 * the write-path's job (it is clamped onto the session at clock-in). This
 * resolver therefore only chooses WHICH premium applies. When the session has
 * its own premium (multiplier or override set) it wins wholesale — the shift is
 * not consulted, matching decision D4.
 */
export function resolveSessionPremium(
  sessionPremium: SessionPremium | null | undefined,
  linkedShiftPremium: SessionPremium | null | undefined,
): SessionPremium {
  if (hasPremium(sessionPremium)) return sessionPremium as SessionPremium;
  if (hasPremium(linkedShiftPremium)) return linkedShiftPremium as SessionPremium;
  return {
    rateMultiplier: null,
    rateOverride: null,
    premiumReason: null,
    premiumStartAt: null,
    premiumEndAt: null,
  };
}

/**
 * Planned-shift variant: cost a scheduled shift (rota estimate + portal planned
 * pay). Resolves the time-of-day premium window to instants on the shift date
 * (overnight-aware), computes paidHours via calculatePaidHours, then delegates
 * to computeSessionPremiumPay so the maths is identical to the paid path.
 */
export function computePlannedShiftPremiumPay(
  shiftDate: string, // "yyyy-MM-dd"
  startTime: string, // "HH:mm"
  endTime: string,   // "HH:mm"
  unpaidBreakMinutes: number,
  baseRate: number,
  premium: ShiftPremium,
  isOvernight = false,
): PremiumPayResult {
  const paidHours = calculatePaidHours(startTime, endTime, unpaidBreakMinutes, isOvernight);

  const { startAt, endAt, premiumStartAt, premiumEndAt } = resolveShiftWindowInstants(
    shiftDate,
    startTime,
    endTime,
    isOvernight,
    premium.premiumStartTime,
    premium.premiumEndTime,
  );

  return computeSessionPremiumPay(startAt, endAt, paidHours, baseRate, {
    rateMultiplier: premium.rateMultiplier,
    rateOverride: premium.rateOverride,
    premiumReason: premium.premiumReason,
    premiumStartAt: premiumStartAt,
    premiumEndAt: premiumEndAt,
  });
}

/** "HH:mm" or "HH:mm:ss" → minutes since midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Build a UTC instant for a London wall-clock date + "HH:mm" time-of-day. */
function londonInstant(dateIso: string, time: string): Date {
  const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
  const parsed = parseLondonDateTimeLocal(`${dateIso}T${hhmm}`);
  if (!parsed) throw new Error(`Invalid London date/time: ${dateIso}T${hhmm}`);
  return parsed;
}

/**
 * Add whole days to a "yyyy-MM-dd" string, returning "yyyy-MM-dd".
 * Pure calendar arithmetic in UTC — timezone-independent, so it is not skewed
 * by the runtime's local zone (unlike date-fns parseISO on a date-only string).
 */
function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Resolve a shift's start/end and its time-of-day premium window into UTC
 * instants on the correct calendar day(s), honouring overnight shifts.
 *
 * Overnight handling: any time-of-day that is at or before the start time is
 * treated as belonging to the following day. This puts an "after 00:00"
 * premium window on the correct side of midnight for a shift that runs, say,
 * 20:00 → 04:00. When no window is given, the premium instants are null (whole
 * shift), and computeSessionPremiumPay treats it as the whole worked interval.
 */
export function resolveShiftWindowInstants(
  shiftDate: string,
  startTime: string,
  endTime: string,
  isOvernight: boolean,
  premiumStartTime: string | null,
  premiumEndTime: string | null,
): { startAt: Date; endAt: Date; premiumStartAt: Date | null; premiumEndAt: Date | null } {
  const startMin = timeToMinutes(startTime);
  const overnight = isOvernight || timeToMinutes(endTime) < startMin;

  const startAt = londonInstant(shiftDate, startTime);
  const endDate = overnight ? addDaysIso(shiftDate, 1) : shiftDate;
  const endAt = londonInstant(endDate, endTime);

  // A time-of-day STRICTLY before the shift start on an overnight shift is on
  // day+1. A time EQUAL to the start is the first instant worked on day 0, so it
  // must NOT wrap — otherwise a window that opens at the shift start collapses to
  // zero overlap.
  const dayFor = (time: string): string =>
    overnight && timeToMinutes(time) < startMin ? addDaysIso(shiftDate, 1) : shiftDate;

  const premiumStartAt = premiumStartTime != null ? londonInstant(dayFor(premiumStartTime), premiumStartTime) : null;
  const premiumEndAt = premiumEndTime != null ? londonInstant(dayFor(premiumEndTime), premiumEndTime) : null;

  return { startAt, endAt, premiumStartAt, premiumEndAt };
}
