import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /timeclock is a public, unauthenticated kiosk route on a shared iPad.
 * Everything clockIn, clockOut and getOpenSessions return is serialised into a
 * response the browser receives, whether or not the component renders it, so a
 * `SELECT *` there hands manager-only pay data to whoever is standing at the
 * kiosk.
 *
 * These tests capture the actual column list passed to `.select()` and fail if
 * any of the three paths starts selecting pay or review columns again. They
 * assert on the query, not on the rendered output, because the leak happens on
 * the wire regardless of what the component chooses to display.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }));
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/timeclock/pin', () => ({
  normalizeTimeclockPin: (pin: string) => pin ?? '',
  verifyTimeclockPin: () => true,
  phoneLastFourMatchesPin: () => true,
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { clockIn, clockOut, getOpenSessions } from '../timeclock';

/** Columns that must never leave the database on a kiosk-reachable read. */
const FORBIDDEN = [
  'manager_note',
  'rate_multiplier',
  'rate_override',
  'premium_reason',
  'premium_start_at',
  'premium_end_at',
  'is_reviewed',
  'reviewed_by',
  'notes',
];

/**
 * Records every column list requested against `timeclock_sessions`, and serves
 * whatever rows the action needs to reach its return. Employee lookups and the
 * shift-linking / payroll queries are satisfied with harmless stubs.
 */
function createCapturingMock(sessionRow: Record<string, unknown> | null) {
  const selects: string[] = [];

  const from = vi.fn().mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;

    chain.eq = vi.fn(passthrough);
    chain.is = vi.fn(passthrough);
    chain.in = vi.fn(passthrough);
    chain.lte = vi.fn(passthrough);
    chain.gte = vi.fn(passthrough);
    chain.limit = vi.fn(passthrough);
    chain.order = vi.fn(passthrough);
    chain.insert = vi.fn(passthrough);
    chain.update = vi.fn(passthrough);

    if (table === 'employees') {
      chain.select = vi.fn(passthrough);
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
      // The one thing under test: what did we ask the database for?
      chain.select = vi.fn().mockImplementation((cols?: string) => {
        selects.push(cols ?? '*');
        return chain;
      });
      chain.single = vi.fn().mockResolvedValue({
        data: sessionRow ?? { id: 'sess-1', employee_id: 'emp-1', clock_in_at: '2026-08-30T10:00:00Z' },
        error: null,
      });
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: sessionRow, error: null });
      (chain as { then: unknown }).then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: sessionRow ? [sessionRow] : [], error: null });
      return chain;
    }

    chain.select = vi.fn(passthrough);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    (chain as { then: unknown }).then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: [], error: null });
    return chain;
  });

  return { from, selects };
}

/** Every column list this action asked `timeclock_sessions` for. */
function sessionSelects(selects: string[]): string {
  return selects.join(' | ');
}

describe('kiosk-reachable timeclock reads never select pay or review columns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clockIn selects only the three kiosk-safe columns', async () => {
    const mock = createCapturingMock(null);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    await clockIn('emp-1', '1234');

    const asked = sessionSelects(mock.selects);
    expect(asked).not.toMatch(/\*/);
    for (const column of FORBIDDEN) {
      expect(asked).not.toContain(column);
    }
  });

  it('clockOut selects only the three kiosk-safe columns', async () => {
    const mock = createCapturingMock({
      id: 'sess-1',
      employee_id: 'emp-1',
      work_date: '2026-08-30',
      clock_in_at: '2026-08-30T10:00:00Z',
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    await clockOut('emp-1', '1234');

    const asked = sessionSelects(mock.selects);
    expect(asked).not.toMatch(/\*/);
    for (const column of FORBIDDEN) {
      expect(asked).not.toContain(column);
    }
  });

  it('getOpenSessions selects only the kiosk-safe columns plus the employee name join', async () => {
    const mock = createCapturingMock(null);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    await getOpenSessions();

    const asked = sessionSelects(mock.selects);
    expect(asked).not.toMatch(/\*/);
    for (const column of FORBIDDEN) {
      expect(asked).not.toContain(column);
    }
    // The name is what the "who is on shift" displays are actually for.
    expect(asked).toContain('employees!timeclock_sessions_employee_id_fkey');
    expect(asked).toContain('clock_in_at');
  });
});
