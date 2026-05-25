import { createAdminClient } from '@/lib/supabase/admin';
import {
  PNL_METRICS,
  PNL_TIMEFRAMES,
  type PnlTimeframeKey,
  MANUAL_METRIC_KEYS,
  EXPENSE_METRIC_KEYS,
  PNL_METRIC_BY_KEY,
  PNL_TARGET_METRIC_KEYS,
} from '@/lib/pnl/constants';
import {
  GREENE_KING_ANNUAL_TARGETS,
  GREENE_KING_BENCHMARK,
  type GreeneKingBenchmark,
} from '@/lib/pnl/greene-king-benchmark';
import type { PLManualActual, PLTarget, PLTimeframe, ReceiptExpenseCategory } from '@/types/database';
import type { CashupSalesCategory, CashupStatus } from '@/types/cashing-up';

const INCLUDED_STATUSES = ['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'] as const;
const RECEIPT_PAGE_SIZE = 1000;

type TargetMap = Record<string, Partial<Record<PLTimeframe, number | null>>>;
type ManualActualMap = Record<string, Partial<Record<PLTimeframe, number | null>>>;
type AggregatedActuals = Record<PnlTimeframeKey, Record<string, number>>;
type CashupSalesSummary = Record<PnlTimeframeKey, {
  totalRevenue: number;
  drinksSales: number;
  foodSales: number;
  otherSales: number;
  foodPlusOtherSales: number;
  unallocatedSales: number;
  sessionCount: number;
  missingSplitCount: number;
  excludedDraftCount: number;
  latestSessionDate: string | null;
}>;

export type PnlDataQuality = {
  warnings: string[];
  receiptAggregationFailed: boolean;
  cashupAggregationFailed: boolean;
};

export type PnlDashboardData = {
  metrics: typeof PNL_METRICS;
  timeframes: typeof PNL_TIMEFRAMES;
  actuals: AggregatedActuals;
  targets: TargetMap;
  manualActuals: ManualActualMap;
  expenseTotals: Record<PnlTimeframeKey, number>;
  cashupSales: CashupSalesSummary;
  dataQuality: PnlDataQuality;
  greeneKingBenchmark: GreeneKingBenchmark;
};

type SaveEntry = {
  metric: string;
  timeframe: PLTimeframe;
  value: number | null;
};

type DeletionPair = {
  metric: string;
  timeframe: PLTimeframe;
};

type ReceiptExpenseRow = {
  transaction_date: string | null;
  expense_category: ReceiptExpenseCategory | null;
  amount_out: number | null;
};

type CashupSalesBreakdownRow = {
  sales_category: CashupSalesCategory | null;
  amount: number | null;
};

type CashupSalesRow = {
  id: string;
  session_date: string | null;
  status: CashupStatus | null;
  total_counted_amount: number | null;
  cashup_sales_breakdowns?: CashupSalesBreakdownRow[] | null;
};

type ImportedSalesRow = {
  sale_date: string | null;
  drinks_sales: number | null;
  food_sales: number | null;
  other_sales: number | null;
  total_sales: number | null;
};

function timeframeStartDate(timeframe: PnlTimeframeKey): string {
  const config = PNL_TIMEFRAMES.find((item) => item.key === timeframe);
  if (!config) return new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (config.days - 1));
  return start.toISOString().slice(0, 10);
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function createEmptyCashupSummary(): CashupSalesSummary {
  return {
    '1m': {
      totalRevenue: 0,
      drinksSales: 0,
      foodSales: 0,
      otherSales: 0,
      foodPlusOtherSales: 0,
      unallocatedSales: 0,
      sessionCount: 0,
      missingSplitCount: 0,
      excludedDraftCount: 0,
      latestSessionDate: null,
    },
    '3m': {
      totalRevenue: 0,
      drinksSales: 0,
      foodSales: 0,
      otherSales: 0,
      foodPlusOtherSales: 0,
      unallocatedSales: 0,
      sessionCount: 0,
      missingSplitCount: 0,
      excludedDraftCount: 0,
      latestSessionDate: null,
    },
    '12m': {
      totalRevenue: 0,
      drinksSales: 0,
      foodSales: 0,
      otherSales: 0,
      foodPlusOtherSales: 0,
      unallocatedSales: 0,
      sessionCount: 0,
      missingSplitCount: 0,
      excludedDraftCount: 0,
      latestSessionDate: null,
    },
  };
}

function isExpenseOutgoingAmount(value: number | null): value is number {
  if (typeof value !== 'number') return false;
  return Number.isFinite(value);
}

function isValidTimeframe(value: string): value is PLTimeframe {
  return value === '1m' || value === '3m' || value === '12m';
}

function assertValidSaveEntry(entry: SaveEntry, manualOnly: boolean) {
  if (!PNL_TARGET_METRIC_KEYS.includes(entry.metric)) {
    throw new Error(`Invalid P&L metric key: ${entry.metric}`);
  }

  if (!isValidTimeframe(entry.timeframe)) {
    throw new Error(`Invalid P&L timeframe: ${entry.timeframe}`);
  }

  const metric = PNL_METRIC_BY_KEY.get(entry.metric);
  if (manualOnly && !MANUAL_METRIC_KEYS.includes(entry.metric)) {
    throw new Error(`Metric cannot be entered manually: ${entry.metric}`);
  }

  if (entry.value === null || Number.isNaN(entry.value)) return;

  if (!Number.isFinite(entry.value)) {
    throw new Error(`Invalid P&L value for ${entry.metric}`);
  }

  if (entry.value < 0) {
    throw new Error(`P&L values cannot be negative: ${entry.metric}`);
  }

  if (metric?.format === 'percent' && (entry.value < 0 || entry.value > 100)) {
    throw new Error(`Percentage values must be between 0 and 100: ${entry.metric}`);
  }
}

function createDefaultTargetMap(): TargetMap {
  const map: TargetMap = {};

  Object.entries(GREENE_KING_ANNUAL_TARGETS).forEach(([metricKey, values]) => {
    map[metricKey] = { ...values };
  });

  return map;
}

function dedupeDeletionPairs(entries: SaveEntry[]): DeletionPair[] {
  const seen = new Set<string>();
  const pairs: DeletionPair[] = [];

  for (const entry of entries) {
    const key = `${entry.metric}::${entry.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ metric: entry.metric, timeframe: entry.timeframe });
  }

  return pairs;
}

async function deleteFinancialRowsByPair(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'pl_targets' | 'pl_manual_actuals',
  pairs: DeletionPair[],
  fallbackErrorMessage: string
) {
  const results = await Promise.all(
    pairs.map((pair) =>
      supabase
        .from(table)
        .delete()
        .eq('metric_key', pair.metric)
        .eq('timeframe', pair.timeframe)
    )
  );

  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    throw new Error(firstError.error.message || fallbackErrorMessage);
  }
}

// TODO(tech-debt): Parallelise page fetches with Promise.all for better performance — tracked in technical debt report PF-1
// If total count is known upfront, parallelise page fetches to reduce latency on
// large datasets. Currently sequential because the total is discovered during iteration.
async function fetchReceiptExpenseRows(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string
): Promise<ReceiptExpenseRow[]> {
  const rows: ReceiptExpenseRow[] = [];

  for (let from = 0; ; from += RECEIPT_PAGE_SIZE) {
    const to = from + RECEIPT_PAGE_SIZE - 1;
    const { data, error } = await supabase.from('receipt_transactions')
      .select('id, transaction_date, expense_category, amount_out')
      .gte('transaction_date', startDate)
      .in('status', INCLUDED_STATUSES)
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message || 'Failed to aggregate receipts for P&L dashboard');
    }

    if (!data?.length) {
      break;
    }

    rows.push(...(data as ReceiptExpenseRow[]));

    if (data.length < RECEIPT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchCashupSalesRows(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string
): Promise<CashupSalesRow[]> {
  const { data, error } = await supabase
    .from('cashup_sessions')
    .select(`
      id,
      session_date,
      status,
      total_counted_amount,
      cashup_sales_breakdowns (
        sales_category,
        amount
      )
    `)
    .gte('session_date', startDate)
    .in('status', ['draft', 'submitted', 'approved', 'locked'])
    .order('session_date', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Failed to aggregate cash-up sales for P&L dashboard');
  }

  return (data ?? []) as CashupSalesRow[];
}

async function fetchImportedSalesRows(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string
): Promise<ImportedSalesRow[]> {
  try {
    const { data, error } = await supabase
      .from('pnl_sales_imports')
      .select('sale_date, drinks_sales, food_sales, other_sales, total_sales')
      .eq('source', 'till_csv')
      .eq('source_section', 'Net sales')
      .gte('sale_date', startDate)
      .order('sale_date', { ascending: false });

    if (error) {
      throw new Error(error.message || 'Failed to aggregate imported till sales for P&L dashboard');
    }

    return (data ?? []) as ImportedSalesRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('pnl_sales_imports')) {
      return [];
    }
    throw error;
  }
}

async function fetchGreeneKingBenchmark(
  supabase: ReturnType<typeof createAdminClient>
): Promise<GreeneKingBenchmark> {
  try {
    const { data, error } = await supabase
      .from('greene_king_pnl_benchmarks')
      .select(`
        benchmark_key,
        pub_code,
        pub_name,
        proposal_id,
        assessment_date,
        report_date,
        agreement_type,
        agreement_reason,
        tie_details,
        greene_king_pnl_benchmark_rows (
          section,
          metric_key,
          label,
          row_order,
          annual_amount,
          gross_profit,
          gross_profit_percent,
          sales_mix_percent,
          percent_of_sales
        )
      `)
      .eq('is_active', true)
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return GREENE_KING_BENCHMARK;
    }

    const row = data as any;
    return {
      benchmarkKey: row.benchmark_key,
      pubCode: row.pub_code,
      pubName: row.pub_name,
      proposalId: row.proposal_id,
      assessmentDate: row.assessment_date,
      reportDate: row.report_date,
      agreementType: row.agreement_type,
      agreementReason: row.agreement_reason,
      tieDetails: row.tie_details,
      rows: (row.greene_king_pnl_benchmark_rows ?? [])
        .map((benchmarkRow: any) => ({
          section: benchmarkRow.section,
          metricKey: benchmarkRow.metric_key,
          label: benchmarkRow.label,
          rowOrder: benchmarkRow.row_order,
          annualAmount: benchmarkRow.annual_amount,
          grossProfit: benchmarkRow.gross_profit,
          grossProfitPercent: benchmarkRow.gross_profit_percent,
          salesMixPercent: benchmarkRow.sales_mix_percent,
          percentOfSales: benchmarkRow.percent_of_sales,
        }))
        .sort((a: any, b: any) => a.rowOrder - b.rowOrder),
    };
  } catch {
    return GREENE_KING_BENCHMARK;
  }
}

function applyCashupRowsToSummary(
  rows: CashupSalesRow[],
  timeframeStartMap: Record<PnlTimeframeKey, string>
): CashupSalesSummary {
  const summary = createEmptyCashupSummary();

  for (const row of rows) {
    if (!row.session_date) continue;

    PNL_TIMEFRAMES.forEach((timeframe) => {
      if (!row.session_date || row.session_date < timeframeStartMap[timeframe.key]) return;

      const bucket = summary[timeframe.key];
      if (row.status === 'draft') {
        bucket.excludedDraftCount += 1;
        return;
      }

      const totalRevenue = Number(row.total_counted_amount ?? 0);
      const breakdowns = row.cashup_sales_breakdowns ?? [];
      const drinksSales = breakdowns
        .filter((item) => item.sales_category === 'drinks_sales')
        .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
      const foodSales = breakdowns
        .filter((item) => item.sales_category === 'food_sales')
        .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
      const otherSales = breakdowns
        .filter((item) => item.sales_category === 'other_sales')
        .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
      const splitTotal = roundCurrency(drinksSales + foodSales + otherSales);
      const unallocated = roundCurrency(totalRevenue - splitTotal);

      bucket.sessionCount += 1;
      bucket.totalRevenue = roundCurrency(bucket.totalRevenue + totalRevenue);
      bucket.drinksSales = roundCurrency(bucket.drinksSales + drinksSales);
      bucket.foodSales = roundCurrency(bucket.foodSales + foodSales);
      bucket.otherSales = roundCurrency(bucket.otherSales + otherSales);
      bucket.foodPlusOtherSales = roundCurrency(bucket.foodPlusOtherSales + foodSales + otherSales);
      bucket.unallocatedSales = roundCurrency(bucket.unallocatedSales + unallocated);

      if (!breakdowns.length || Math.abs(unallocated) > 0.01) {
        bucket.missingSplitCount += 1;
      }

      if (!bucket.latestSessionDate || row.session_date > bucket.latestSessionDate) {
        bucket.latestSessionDate = row.session_date;
      }
    });
  }

  return summary;
}

function applyImportedSalesRowsToSummary(
  rows: ImportedSalesRow[],
  timeframeStartMap: Record<PnlTimeframeKey, string>
): CashupSalesSummary {
  const summary = createEmptyCashupSummary();

  for (const row of rows) {
    if (!row.sale_date) continue;

    PNL_TIMEFRAMES.forEach((timeframe) => {
      if (!row.sale_date || row.sale_date < timeframeStartMap[timeframe.key]) return;

      const bucket = summary[timeframe.key];
      const drinksSales = Number(row.drinks_sales ?? 0);
      const foodSales = Number(row.food_sales ?? 0);
      const otherSales = Number(row.other_sales ?? 0);
      const splitTotal = roundCurrency(drinksSales + foodSales + otherSales);
      const totalSales = Number(row.total_sales ?? splitTotal);

      bucket.sessionCount += 1;
      bucket.totalRevenue = roundCurrency(bucket.totalRevenue + totalSales);
      bucket.drinksSales = roundCurrency(bucket.drinksSales + drinksSales);
      bucket.foodSales = roundCurrency(bucket.foodSales + foodSales);
      bucket.otherSales = roundCurrency(bucket.otherSales + otherSales);
      bucket.foodPlusOtherSales = roundCurrency(bucket.foodPlusOtherSales + foodSales + otherSales);

      if (!bucket.latestSessionDate || row.sale_date > bucket.latestSessionDate) {
        bucket.latestSessionDate = row.sale_date;
      }
    });
  }

  return summary;
}

export class FinancialService {
  static async getPlDashboardData(): Promise<PnlDashboardData> {
    const supabase = createAdminClient();

    const [targetRows, manualRows, greeneKingBenchmark] = await Promise.all([
      supabase.from('pl_targets').select('metric_key, timeframe, target_value'),
      supabase.from('pl_manual_actuals').select('metric_key, timeframe, value'),
      fetchGreeneKingBenchmark(supabase),
    ]);

    if (targetRows.error) {
      throw new Error(targetRows.error.message || 'Failed to load P&L targets');
    }
    if (manualRows.error) {
      throw new Error(manualRows.error.message || 'Failed to load manual P&L inputs');
    }

    const targetMap: TargetMap = createDefaultTargetMap();
    (targetRows.data as unknown as PLTarget[])?.forEach((row) => {
      if (!targetMap[row.metric_key]) {
        targetMap[row.metric_key] = {};
      }
      targetMap[row.metric_key][row.timeframe] = row.target_value;
    });

    const manualMap: ManualActualMap = {};
    (manualRows.data as unknown as PLManualActual[])?.forEach((row) => {
      if (!manualMap[row.metric_key]) {
        manualMap[row.metric_key] = {};
      }
      manualMap[row.metric_key][row.timeframe] = row.value;
    });

    const actuals: AggregatedActuals = {
      '1m': {},
      '3m': {},
      '12m': {},
    };
    const expenseTotals: Record<PnlTimeframeKey, number> = {
      '1m': 0,
      '3m': 0,
      '12m': 0,
    };
    const warnings: string[] = [];
    let receiptAggregationFailed = false;
    let cashupAggregationFailed = false;

    const expenseMetricMap = new Map<ReceiptExpenseCategory, string>();
    PNL_METRICS.filter((metric) => metric.type === 'expense' && metric.expenseCategory).forEach((metric) => {
      expenseMetricMap.set(metric.expenseCategory as ReceiptExpenseCategory, metric.key);
    });

    const timeframeStartMap: Record<PnlTimeframeKey, string> = {
      '1m': timeframeStartDate('1m'),
      '3m': timeframeStartDate('3m'),
      '12m': timeframeStartDate('12m'),
    };
    const oldestStartDate = Object.values(timeframeStartMap).sort()[0] ?? timeframeStartDate('12m');

    const expenseSumsByTimeframe: Record<PnlTimeframeKey, Record<string, number>> = {
      '1m': {},
      '3m': {},
      '12m': {},
    };

    let cashupSales = createEmptyCashupSummary();
    let importedSalesRows: ImportedSalesRow[] = [];

    try {
      importedSalesRows = await fetchImportedSalesRows(supabase, oldestStartDate);
    } catch (error) {
      warnings.push('Imported till sales could not be loaded, so P&L sales may fall back to cash-up data.');
      console.error('Failed to aggregate imported till sales for P&L dashboard:', error);
    }

    try {
      if (importedSalesRows.length > 0) {
        cashupSales = applyImportedSalesRowsToSummary(importedSalesRows, timeframeStartMap);
      } else {
        const cashupRows = await fetchCashupSalesRows(supabase, oldestStartDate);
        cashupSales = applyCashupRowsToSummary(cashupRows, timeframeStartMap);
      }
    } catch (error) {
      cashupAggregationFailed = true;
      warnings.push('Cash-up sales could not be loaded, so actual income may be incomplete.');
      console.error('Failed to aggregate cash-up sales for P&L dashboard:', error);
    }

    try {
      const rows = await fetchReceiptExpenseRows(supabase, oldestStartDate);

      rows.forEach((row) => {
        const transactionDate = row.transaction_date;
        const category = row.expense_category;
        if (!transactionDate || !category) return;

        const key = expenseMetricMap.get(category);
        if (!key) return;

        if (!isExpenseOutgoingAmount(row.amount_out)) return;
        const amount = row.amount_out;

        PNL_TIMEFRAMES.forEach((timeframe) => {
          if (transactionDate >= timeframeStartMap[timeframe.key]) {
            const timeframeSums = expenseSumsByTimeframe[timeframe.key];
            timeframeSums[key] = (timeframeSums[key] ?? 0) + amount;
          }
        });
      });
    } catch (error) {
      receiptAggregationFailed = true;
      warnings.push('Receipt expenses could not be loaded, so actual expenses may be incomplete.');
      console.error('Failed to aggregate receipts for P&L dashboard:', error);
    }

    for (const timeframe of PNL_TIMEFRAMES) {
      const sums = expenseSumsByTimeframe[timeframe.key];
      const sales = cashupSales[timeframe.key];

      expenseTotals[timeframe.key] = roundCurrency(
        EXPENSE_METRIC_KEYS.reduce((sum, key) => sum + (sums[key] ?? 0), 0)
      );

      actuals[timeframe.key] = {};

      PNL_METRICS.forEach((metric) => {
        if (metric.type === 'expense') {
          actuals[timeframe.key][metric.key] = roundCurrency(sums[metric.key] ?? 0);
        } else if (metric.type === 'cashup') {
          actuals[timeframe.key][metric.key] = metric.key === 'drinks_sales'
            ? sales.drinksSales
            : sales.foodPlusOtherSales;
        } else {
          const manualValue = manualMap[metric.key]?.[timeframe.key as PLTimeframe];
          actuals[timeframe.key][metric.key] = roundCurrency(manualValue ?? 0);
        }
      });

      if (sales.sessionCount === 0) {
        warnings.push(`No completed cash-up or imported till sales rows found for ${timeframe.label}.`);
      }
      if (sales.missingSplitCount > 0) {
        warnings.push(`${sales.missingSplitCount} completed cash-up ${sales.missingSplitCount === 1 ? 'session is' : 'sessions are'} missing a matching drinks/food/other split in ${timeframe.label}.`);
      }
      if (Math.abs(sales.unallocatedSales) > 0.01) {
        warnings.push(`${timeframe.label} has ${roundCurrency(sales.unallocatedSales).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} of cash-up sales not allocated cleanly to drinks, food, or other.`);
      }
      if (sales.excludedDraftCount > 0) {
        warnings.push(`${sales.excludedDraftCount} draft cash-up ${sales.excludedDraftCount === 1 ? 'session was' : 'sessions were'} excluded from ${timeframe.label}.`);
      }
    }

    return {
      metrics: PNL_METRICS,
      timeframes: PNL_TIMEFRAMES,
      actuals,
      targets: targetMap,
      manualActuals: manualMap,
      expenseTotals,
      cashupSales,
      dataQuality: {
        warnings: Array.from(new Set(warnings)),
        receiptAggregationFailed,
        cashupAggregationFailed,
      },
      greeneKingBenchmark,
    };
  }

  static async savePlTargets(entries: SaveEntry[]) {
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    entries.forEach((entry) => assertValidSaveEntry(entry, false));

    const upserts = entries
      .filter((entry) => entry.value !== null && !Number.isNaN(entry.value))
      .map((entry) => ({
        metric_key: entry.metric,
        timeframe: entry.timeframe,
        target_value: entry.value,
        updated_at: now,
      }));

    const deletions = entries.filter((entry) => entry.value === null || Number.isNaN(entry.value));

    if (upserts.length) {
      const { error } = await supabase
        .from('pl_targets')
        .upsert(upserts, { onConflict: 'metric_key,timeframe' });

      if (error) {
        throw new Error(error.message || 'Failed to save P&L targets');
      }
    }

    if (deletions.length) {
      await deleteFinancialRowsByPair(
        supabase,
        'pl_targets',
        dedupeDeletionPairs(deletions),
        'Failed to clear P&L targets'
      );
    }
  }

  static async savePlManualActuals(entries: SaveEntry[]) {
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    entries.forEach((entry) => assertValidSaveEntry(entry, true));

    const filteredEntries = entries.filter((entry) => MANUAL_METRIC_KEYS.includes(entry.metric));

    const upserts = filteredEntries
      .filter((entry) => entry.value !== null && !Number.isNaN(entry.value))
      .map((entry) => ({
        metric_key: entry.metric,
        timeframe: entry.timeframe,
        value: entry.value,
        updated_at: now,
      }));

    const deletions = filteredEntries.filter((entry) => entry.value === null || Number.isNaN(entry.value));

    if (upserts.length) {
      const { error } = await supabase
        .from('pl_manual_actuals')
        .upsert(upserts, { onConflict: 'metric_key,timeframe' });

      if (error) {
        throw new Error(error.message || 'Failed to save manual P&L inputs');
      }
    }

    if (deletions.length) {
      await deleteFinancialRowsByPair(
        supabase,
        'pl_manual_actuals',
        dedupeDeletionPairs(deletions),
        'Failed to clear manual P&L inputs'
      );
    }
  }
}
