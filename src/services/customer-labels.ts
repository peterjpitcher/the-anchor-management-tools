import { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A customer counts as "new" for 30 days after they are created. That is the
 * same window `apply_customer_labels_retroactively` uses when it adds the
 * label, expressed as `created_at >= CURRENT_DATE - INTERVAL '30 days'`. The
 * RPC only ever inserts, so without the sweep in expireNewCustomerLabels the
 * label stays on forever (514 of 631 assignments were stale when this was
 * written).
 */
const NEW_CUSTOMER_LABEL_NAME = 'New Customer';
const NEW_CUSTOMER_WINDOW_DAYS = 30;

const PAGE_SIZE = 1000;
/** Ids travel in the query string, so keep each delete batch small. */
const DELETE_CHUNK_SIZE = 100;

export type AppliedLabelSummary = {
  customer_id: string;
  applied_labels: string[];
};

export type ApplyLabelsResult = {
  /** Labels actually added by this run, grouped by customer */
  applied: AppliedLabelSummary[];
  /** "New Customer" assignments removed because the customer is no longer new */
  expiredNewCustomer: number;
};

type PagedResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PagedResult<T>>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function resolveRelation<T>(relation: T | T[] | null): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

/**
 * Midnight UTC, `days` ago, in milliseconds. Mirrors Postgres
 * `CURRENT_DATE - INTERVAL 'n days'` exactly (the database runs in UTC), so the
 * expiry sweep can never remove a label the RPC would immediately add back.
 */
function midnightUtcDaysAgoMs(days: number): number {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.getTime();
}

export class CustomerLabelService {
  /**
   * Refreshes the category stats, applies the automatic labels, then expires
   * the "New Customer" label for anyone who has aged out of the window.
   *
   * `apply_customer_labels_retroactively` returns void, so the only way to
   * report what it did is to diff the assignments table around the call.
   */
  static async applyLabelsRetroactively(): Promise<ApplyLabelsResult> {
    const admin = createAdminClient();

    console.warn('Rebuilding customer category stats...');
    // The live function is rebuild_customer_category_stats. This used to call
    // backfill_customer_category_stats, which does not exist, so the step
    // silently failed and the labels were applied against stale stats.
    const { data: rebuiltCount, error: rebuildError } = await admin
      .rpc('rebuild_customer_category_stats');

    if (rebuildError) {
      console.error('Error rebuilding customer category stats:', rebuildError);
      // Continue anyway - partial data is better than none
    } else {
      console.warn(`Rebuilt ${rebuiltCount || 0} customer category stats`);
    }

    // Watermark read from the database clock (assigned_at defaults to now()),
    // so the diff below cannot be skewed by the app server's clock.
    const { data: latestBefore, error: watermarkError } = await admin
      .from('customer_label_assignments')
      .select('assigned_at')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (watermarkError) throw watermarkError;

    const { error } = await admin.rpc('apply_customer_labels_retroactively');
    if (error) throw error;

    const applied = await CustomerLabelService.collectLabelsAppliedSince(
      admin,
      latestBefore?.assigned_at ?? null
    );
    const expiredNewCustomer = await CustomerLabelService.expireNewCustomerLabels(admin);

    return { applied, expiredNewCustomer };
  }

  /** Everything auto-assigned after `watermark`, grouped by customer. */
  private static async collectLabelsAppliedSince(
    admin: AdminClient,
    watermark: string | null
  ): Promise<AppliedLabelSummary[]> {
    type AssignmentRow = {
      customer_id: string;
      label: { name: string } | { name: string }[] | null;
    };

    const rows = await fetchAllPages<AssignmentRow>((from, to) => {
      const query = admin
        .from('customer_label_assignments')
        .select('customer_id, label:customer_labels(name)')
        .eq('auto_assigned', true)
        .order('assigned_at', { ascending: true })
        .range(from, to);

      // No watermark means the table was empty before this run, so every row is new.
      return watermark ? query.gt('assigned_at', watermark) : query;
    });

    const appliedByCustomer = new Map<string, string[]>();
    for (const row of rows) {
      const name = resolveRelation(row.label)?.name;
      if (!name) continue;

      const existing = appliedByCustomer.get(row.customer_id);
      if (existing) {
        existing.push(name);
      } else {
        appliedByCustomer.set(row.customer_id, [name]);
      }
    }

    return Array.from(appliedByCustomer.entries()).map(([customer_id, applied_labels]) => ({
      customer_id,
      applied_labels
    }));
  }

  /** Drops the auto-applied "New Customer" label once the customer is no longer new. */
  private static async expireNewCustomerLabels(admin: AdminClient): Promise<number> {
    const { data: label, error: labelError } = await admin
      .from('customer_labels')
      .select('id')
      .eq('name', NEW_CUSTOMER_LABEL_NAME)
      .maybeSingle();

    if (labelError) throw labelError;
    if (!label) return 0;

    type AssignmentWithCustomer = {
      customer_id: string;
      customer: { created_at: string | null } | { created_at: string | null }[] | null;
    };

    const assignments = await fetchAllPages<AssignmentWithCustomer>((from, to) =>
      admin
        .from('customer_label_assignments')
        .select('customer_id, customer:customers!inner(created_at)')
        .eq('label_id', label.id)
        .eq('auto_assigned', true)
        .order('customer_id', { ascending: true })
        .range(from, to)
    );

    const cutoffMs = midnightUtcDaysAgoMs(NEW_CUSTOMER_WINDOW_DAYS);
    const staleCustomerIds = Array.from(
      new Set(
        assignments
          .filter((row) => {
            const createdAt = resolveRelation(row.customer)?.created_at;
            const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
            // An unreadable creation date does not prove the customer is stale,
            // so leave the label alone rather than guess.
            return Number.isFinite(createdAtMs) && createdAtMs < cutoffMs;
          })
          .map((row) => row.customer_id)
      )
    );

    if (staleCustomerIds.length === 0) return 0;

    let removed = 0;
    for (let i = 0; i < staleCustomerIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = staleCustomerIds.slice(i, i + DELETE_CHUNK_SIZE);
      const { data: deleted, error: deleteError } = await admin
        .from('customer_label_assignments')
        .delete()
        .eq('label_id', label.id)
        // Only ever undo what the automation did; a manually applied label stays.
        .eq('auto_assigned', true)
        .in('customer_id', chunk)
        .select('customer_id');

      if (deleteError) throw deleteError;
      removed += deleted?.length ?? 0;
    }

    return removed;
  }

  static async bulkAssignLabel(labelId: string, customerIds: string[], assignedBy?: string) {
    const admin = createAdminClient();

    // Prepare bulk insert data
    const assignments = customerIds.map(customerId => ({
      customer_id: customerId,
      label_id: labelId,
      assigned_by: assignedBy,
      auto_assigned: false,
      notes: 'Bulk assigned'
    }));

    // Insert with conflict handling
    const { error } = await admin
      .from('customer_label_assignments')
      .upsert(assignments, { onConflict: 'customer_id,label_id' });

    if (error) {
      throw error;
    }

    return { count: customerIds.length };
  }
}
