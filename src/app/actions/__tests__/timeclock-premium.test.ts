import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing the action under test.
// The premium pay helper (@/lib/rota/pay-calculator) is intentionally NOT mocked
// — it is pure and its window/clamp maths is what we want to exercise.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}));
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
// The PIN check is not what these tests exercise — treat any supplied PIN as valid.
vi.mock('@/lib/timeclock/pin', () => ({
  normalizeTimeclockPin: (pin: string) => pin ?? '',
  verifyTimeclockPin: () => true,
  phoneLastFourMatchesPin: () => true,
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { clockIn, updateTimeclockSession } from '../timeclock';

type SingleResult = { data: unknown; error: unknown };

/**
 * A minimal Supabase admin mock for updateTimeclockSession. The action makes two
 * queries in order:
 *   1. SELECT the existing premium columns (`.single()`)  → existingResult
 *   2. UPDATE the row and return it (`.single()`)         → updateResult (captures the update payload)
 * It also issues the payroll-approval invalidation queries, which are harmless
 * no-ops here (payroll_periods returns empty).
 */
function createAdminMock(existingResult: SingleResult) {
  const captured: { updatePayload?: Record<string, unknown> } = {};
  let singleCall = 0;

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'is', 'lte', 'gte', 'delete']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.update = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    captured.updatePayload = payload;
    return chain;
  });
  chain.single = vi.fn().mockImplementation(() => {
    singleCall += 1;
    // First single() → existing premium read; second → updated row returned.
    if (singleCall === 1) return Promise.resolve(existingResult);
    return Promise.resolve({
      data: { id: 'sess-1', ...(captured.updatePayload ?? {}) },
      error: null,
    });
  });
  // payroll_periods select → then() resolves to empty (no approvals to invalidate).
  chain.then = undefined;

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'payroll_periods') {
      // Return a thenable chain that resolves to an empty period list.
      const periodChain: Record<string, unknown> = {};
      for (const method of ['select', 'lte', 'gte']) {
        periodChain[method] = vi.fn().mockReturnValue(periodChain);
      }
      (periodChain as { then: unknown }).then = (resolve: (v: SingleResult) => void) =>
        resolve({ data: [], error: null });
      return periodChain;
    }
    return chain;
  });

  return { from, captured, chain };
}

const EXISTING_PREMIUM = {
  rate_multiplier: 2,
  rate_override: null,
  premium_reason: 'Double time',
  premium_start_at: '2026-07-07T22:00:00.000Z', // 23:00 London
  premium_end_at: null, // open end = to clock-out
};

describe('updateTimeclockSession — premium preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkUserPermission).mockResolvedValue(true);
  });

  it('rejects when the caller lacks timeclock:edit and payroll:approve', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false);
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', 'note');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Permission denied');
    // No DB work should happen when permission is denied.
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('preserves existing premium on a times/notes-only edit (no premium passed)', async () => {
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', 'fixed clock-out');

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    // Rate + reason are PRESERVED BY OMISSION — a times-only edit never writes
    // the rate columns, so the DB keeps whatever was already there.
    expect(payload).not.toHaveProperty('rate_multiplier');
    expect(payload).not.toHaveProperty('rate_override');
    expect(payload).not.toHaveProperty('premium_reason');
    // The window IS re-written (re-clamped). The stored start (23:00 London) is
    // within the new worked interval (18:00–23:30) so it survives unchanged.
    expect(payload.premium_start_at).toBe('2026-07-07T22:00:00.000Z');
    // Open end stays open (runs to clock-out).
    expect(payload.premium_end_at).toBeNull();
    // Times were updated.
    expect(typeof payload.clock_in_at).toBe('string');
    expect(typeof payload.clock_out_at).toBe('string');
  });

  it('does NOT create a premium on a times-only edit when none existed', async () => {
    // Session with no explicit override. A pure clock-time correction (no premium
    // passed) must never introduce one — it must leave the rate columns untouched.
    const mock = createAdminMock({
      data: {
        rate_multiplier: null,
        rate_override: null,
        premium_reason: null,
        premium_start_at: null,
        premium_end_at: null,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', 'fixed clock-out');

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    // No rate columns written (preserve-by-omission keeps it un-overridden).
    expect(payload).not.toHaveProperty('rate_multiplier');
    expect(payload).not.toHaveProperty('rate_override');
    expect(payload).not.toHaveProperty('premium_reason');
    // The window re-clamp is a no-op: both bounds stay null (whole session / none).
    expect(payload.premium_start_at).toBeNull();
    expect(payload.premium_end_at).toBeNull();
  });

  it('re-clamps a stored premium window when clock times move inside it', async () => {
    // Session has a whole-window premium from 22:00Z; a manager pulls clock-out
    // earlier than the window start, so the clamped start must not exceed clock-out.
    const mock = createAdminMock({
      data: {
        rate_multiplier: 1.5,
        rate_override: null,
        premium_reason: null,
        premium_start_at: '2026-07-07T22:00:00.000Z', // 23:00 London
        premium_end_at: null,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    // Clock-out at 20:00 London (19:00Z) — before the premium window start.
    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '20:00', null);

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    const clockOut = payload.clock_out_at as string;
    // Clamped start must be <= clock-out (window pinned to the shrunken interval).
    expect(new Date(payload.premium_start_at as string).getTime()).toBeLessThanOrEqual(
      new Date(clockOut).getTime(),
    );
    // Rate preserved by omission (times-only edit never writes rate columns).
    expect(payload).not.toHaveProperty('rate_multiplier');
  });

  it('sets premium when explicitly provided', async () => {
    const mock = createAdminMock({
      data: {
        rate_multiplier: null,
        rate_override: null,
        premium_reason: null,
        premium_start_at: null,
        premium_end_at: null,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: 2,
        rateOverride: null,
        premiumReason: 'Bank holiday',
        premiumStartAt: null,
        premiumEndAt: null,
      },
    });

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    expect(payload.rate_multiplier).toBe(2);
    expect(payload.premium_reason).toBe('Bank holiday');
    // Whole-session premium (no window).
    expect(payload.premium_start_at).toBeNull();
    expect(payload.premium_end_at).toBeNull();
  });

  it('clears premium when an explicit "none" premium is provided', async () => {
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: null,
        rateOverride: null,
        premiumReason: null,
        premiumStartAt: null,
        premiumEndAt: null,
      },
    });

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    expect(payload.rate_multiplier).toBeNull();
    expect(payload.rate_override).toBeNull();
    expect(payload.premium_reason).toBeNull();
    expect(payload.premium_start_at).toBeNull();
    expect(payload.premium_end_at).toBeNull();
  });

  it('rejects an out-of-range multiplier before touching the database', async () => {
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: 5, // above the 1.0–3.0 range
        rateOverride: null,
        premiumReason: null,
        premiumStartAt: null,
        premiumEndAt: null,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('multiplier');
  });

  it('rejects a rate override above the £100/hr cap', async () => {
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: null,
        rateOverride: 150, // above the £100/hr cap
        premiumReason: null,
        premiumStartAt: null,
        premiumEndAt: null,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('override');
  });

  it('rejects a reversed premium window (end <= start)', async () => {
    const mock = createAdminMock({ data: EXISTING_PREMIUM, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: 2,
        rateOverride: null,
        premiumReason: null,
        premiumStartAt: '2026-07-07T22:00:00.000Z',
        premiumEndAt: '2026-07-07T20:00:00.000Z', // ends before it starts
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('after');
  });

  it('handles a numeric-as-string multiplier without wiping the premium', async () => {
    // PostgREST hands numeric columns back as strings; an explicit "1.50" must be
    // accepted and stored, not rejected or coerced to no-premium.
    const mock = createAdminMock({
      data: {
        rate_multiplier: null,
        rate_override: null,
        premium_reason: null,
        premium_start_at: null,
        premium_end_at: null,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await updateTimeclockSession('sess-1', '2026-07-07', '18:00', '23:30', null, {
      premium: {
        rateMultiplier: '1.50' as unknown as number, // string, as PostgREST returns
        rateOverride: null,
        premiumReason: null,
        premiumStartAt: null,
        premiumEndAt: null,
      },
    });

    expect(result.success).toBe(true);
    const payload = mock.captured.updatePayload!;
    // Coerced to a real number and stored (not left as a string, not nulled).
    expect(payload.rate_multiplier).toBe(1.5);
  });
});

/**
 * A Supabase admin mock for clockIn. The action, plus its internal
 * linkSessionToShift, hit several tables. We only care about ONE thing: the
 * payload written when the session is linked to a shift — it must NOT carry any
 * premium columns (copy-down removed; premium resolves live from the shift).
 */
function createClockInMock(shift: Record<string, unknown> | null) {
  const captured: { linkUpdatePayload?: Record<string, unknown> } = {};

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'employees') {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          employee_id: 'emp-1',
          status: 'Active',
          mobile_number: '07700900123',
          phone_number: null,
          timeclock_pin_hash: 'hash',
        },
        error: null,
      });
      return chain;
    }

    if (table === 'timeclock_sessions') {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      // Open-session pre-check → no open session.
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      // Insert of the new session → returns the created row.
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: 'sess-new', work_date: '2026-07-07' },
        error: null,
      });
      // Link update → capture the payload.
      chain.update = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        captured.linkUpdatePayload = payload;
        return chain;
      });
      return chain;
    }

    if (table === 'rota_shifts') {
      // Thenable chain resolving to the (optionally premium-bearing) shift list.
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      (chain as { then: unknown }).then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: shift ? [shift] : [], error: null });
      return chain;
    }

    if (table === 'payroll_periods') {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.lte = vi.fn().mockReturnValue(chain);
      chain.gte = vi.fn().mockReturnValue(chain);
      (chain as { then: unknown }).then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: [], error: null });
      return chain;
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { from, captured };
}

describe('clockIn — no premium copy-down on link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkUserPermission).mockResolvedValue(true);
  });

  it('links to a shift without copying its premium onto the session', async () => {
    // clockIn stamps the current time, and linkSessionToShift only matches a
    // shift whose start is within ±2h of it. Derive the shift's start/date from
    // "now" (Europe/London) so the match is deterministic regardless of clock.
    const now = new Date();
    const london = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const part = (t: string) => london.find(p => p.type === t)!.value;
    const shiftDate = `${part('year')}-${part('month')}-${part('day')}`;
    const startTime = `${part('hour')}:${part('minute')}:00`;

    // The matched shift carries a double-time premium. Clock-in must link to it
    // but write ONLY linked_shift_id — never the premium columns.
    const mock = createClockInMock({
      id: 'shift-1',
      start_time: startTime,
      end_time: '23:59:00',
      shift_date: shiftDate,
      is_overnight: false,
      rate_multiplier: 2,
      rate_override: null,
      premium_reason: 'Bank holiday',
      premium_start_time: null,
      premium_end_time: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const result = await clockIn('emp-1', '0123');

    expect(result.success).toBe(true);
    const payload = mock.captured.linkUpdatePayload!;
    // The link happened…
    expect(payload.linked_shift_id).toBe('shift-1');
    // …but NO premium was copied down (resolves live from the shift instead).
    expect(payload).not.toHaveProperty('rate_multiplier');
    expect(payload).not.toHaveProperty('rate_override');
    expect(payload).not.toHaveProperty('premium_reason');
    expect(payload).not.toHaveProperty('premium_start_at');
    expect(payload).not.toHaveProperty('premium_end_at');
  });
});
