/**
 * Leave type reference data.
 *
 * Two rows today (holiday, unavailable) and it changes about never, so it is cached in memory
 * for a few minutes rather than re-read on every holiday total. A stale read here would only
 * ever mean a brand new leave type behaves like the default for a short while.
 */

export type LeaveTypeRow = {
  code: string;
  label: string;
  consumes_allowance: boolean;
  paid: boolean;
  shown_on_rota: boolean;
  counts_in_reliability: boolean;
  allowed_at_onboarding: boolean;
  sort_order: number;
  is_active: boolean;
};

/** The code every existing row carries, and the column default. */
export const DEFAULT_LEAVE_TYPE = 'holiday';

/**
 * Used when the reference table cannot be read. It matches the seeded rows, so a transient
 * database problem degrades to correct behaviour rather than silently counting unavailability
 * against someone's holiday.
 */
const FALLBACK_TYPES: LeaveTypeRow[] = [
  {
    code: 'holiday',
    label: 'Holiday',
    consumes_allowance: true,
    paid: true,
    shown_on_rota: true,
    counts_in_reliability: true,
    allowed_at_onboarding: true,
    sort_order: 1,
    is_active: true,
  },
  {
    code: 'unavailable',
    label: 'Not available to work',
    consumes_allowance: false,
    paid: false,
    shown_on_rota: true,
    counts_in_reliability: false,
    allowed_at_onboarding: true,
    sort_order: 2,
    is_active: true,
  },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { rows: LeaveTypeRow[]; readAt: number } | null = null;

/**
 * Minimal shape of the Supabase clients this module accepts. `select` returns a thenable
 * query builder rather than a real Promise, so this is typed as PromiseLike and both the
 * cookie client and the admin client satisfy it.
 */
type LeaveTypeReader = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export function clearLeaveTypeCache(): void {
  cache = null;
}

export async function getLeaveTypes(client: LeaveTypeReader): Promise<LeaveTypeRow[]> {
  if (cache && Date.now() - cache.readAt < CACHE_TTL_MS) {
    return cache.rows;
  }

  const { data, error } = await client
    .from('leave_types')
    .select('code, label, consumes_allowance, paid, shown_on_rota, counts_in_reliability, allowed_at_onboarding, sort_order, is_active');

  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.error('[leave-types] Falling back to seeded types:', error);
    }
    return FALLBACK_TYPES;
  }

  const rows = data as LeaveTypeRow[];
  cache = { rows, readAt: Date.now() };
  return rows;
}

/**
 * The set of type codes that come off the holiday allowance. Callers pass leave rows through
 * this to decide what to count.
 */
export async function getAllowanceConsumingTypes(client: LeaveTypeReader): Promise<Set<string>> {
  const rows = await getLeaveTypes(client);
  return new Set(rows.filter(row => row.consumes_allowance).map(row => row.code));
}

/** Resolve a stored leave_type value against the allowance-consuming set. */
export function consumesAllowance(
  leaveType: string | null | undefined,
  allowanceConsuming: ReadonlySet<string>,
): boolean {
  return allowanceConsuming.has(leaveType ?? DEFAULT_LEAVE_TYPE);
}
