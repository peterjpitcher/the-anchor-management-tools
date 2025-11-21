import { createAdminClient } from '@/lib/supabase/admin';
import { PNL_METRICS, PNL_TIMEFRAMES, type PnlTimeframeKey, MANUAL_METRIC_KEYS, EXPENSE_METRIC_KEYS } from '@/lib/pnl/constants';
import type { PLManualActual, PLTarget, PLTimeframe, ReceiptExpenseCategory } from '@/types/database';

const INCLUDED_STATUSES = ['pending', 'completed', 'auto_completed', 'no_receipt_required'] as const;

type TargetMap = Record<string, Partial<Record<PLTimeframe, number | null>>>;
type ManualActualMap = Record<string, Partial<Record<PLTimeframe, number | null>>>;
type AggregatedActuals = Record<PnlTimeframeKey, Record<string, number>>;

export type PnlDashboardData = {
  metrics: typeof PNL_METRICS;
  timeframes: typeof PNL_TIMEFRAMES;
  actuals: AggregatedActuals;
  targets: TargetMap;
  manualActuals: ManualActualMap;
  expenseTotals: Record<PnlTimeframeKey, number>;
};

type SaveEntry = {
  metric: string;
  timeframe: PLTimeframe;
  value: number | null;
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

export class FinancialService {
  static async getPlDashboardData(): Promise<PnlDashboardData> {
    const supabase = createAdminClient();

    const [targetRows, manualRows] = await Promise.all([
      supabase.from('pl_targets').select('*'),
      supabase.from('pl_manual_actuals').select('*'),
    ]);

    const targetMap: TargetMap = {};
    targetRows.data?.forEach((row: PLTarget) => {
      if (!targetMap[row.metric_key]) {
        targetMap[row.metric_key] = {};
      }
      targetMap[row.metric_key][row.timeframe] = row.target_value;
    });

    const manualMap: ManualActualMap = {};
    manualRows.data?.forEach((row: PLManualActual) => {
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

    const expenseMetricMap = new Map<ReceiptExpenseCategory, string>();
    PNL_METRICS.filter((metric) => metric.type === 'expense' && metric.expenseCategory).forEach((metric) => {
      expenseMetricMap.set(metric.expenseCategory as ReceiptExpenseCategory, metric.key);
    });

    for (const timeframe of PNL_TIMEFRAMES) {
      const startDate = timeframeStartDate(timeframe.key);

      const { data, error } = await (supabase.from('receipt_transactions') as any)
        .select('expense_category, amount_out, status')
        .gte('transaction_date', startDate)
        .in('status', INCLUDED_STATUSES);

      if (error) {
        console.error('Failed to aggregate receipts for P&L dashboard:', error);
        continue;
      }

      const sums: Record<string, number> = {};

      data?.forEach((row: { expense_category: ReceiptExpenseCategory | null; amount_out: number | null }) => {
        const category = row.expense_category;
        if (!category) return;
        const key = expenseMetricMap.get(category);
        if (!key) return;
        const amount = typeof row.amount_out === 'number' ? row.amount_out : Number(row.amount_out ?? 0);
        if (!Number.isFinite(amount)) return;
        sums[key] = (sums[key] ?? 0) + amount;
      });

      expenseTotals[timeframe.key] = roundCurrency(
        EXPENSE_METRIC_KEYS.reduce((sum, key) => sum + (sums[key] ?? 0), 0)
      );

      actuals[timeframe.key] = {};

      PNL_METRICS.forEach((metric) => {
        if (metric.type === 'expense') {
          actuals[timeframe.key][metric.key] = roundCurrency(sums[metric.key] ?? 0);
        } else {
          const manualValue = manualMap[metric.key]?.[timeframe.key as PLTimeframe];
          actuals[timeframe.key][metric.key] = roundCurrency(manualValue ?? 0);
        }
      });
    }

    return {
      metrics: PNL_METRICS,
      timeframes: PNL_TIMEFRAMES,
      actuals,
      targets: targetMap,
      manualActuals: manualMap,
      expenseTotals,
    };
  }

  static async savePlTargets(entries: SaveEntry[]) {
    const supabase = createAdminClient();
    const now = new Date().toISOString();

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
      const { error } = await supabase
        .from('pl_targets')
        .delete()
        .in('metric_key', deletions.map((entry) => entry.metric))
        .in('timeframe', deletions.map((entry) => entry.timeframe));

      if (error) {
        throw new Error(error.message || 'Failed to clear P&L targets');
      }
    }
  }

  static async savePlManualActuals(entries: SaveEntry[]) {
    const supabase = createAdminClient();
    const now = new Date().toISOString();

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
      const { error } = await supabase
        .from('pl_manual_actuals')
        .delete()
        .in('metric_key', deletions.map((entry) => entry.metric))
        .in('timeframe', deletions.map((entry) => entry.timeframe));

      if (error) {
        throw new Error(error.message || 'Failed to clear manual P&L inputs');
      }
    }
  }
}
