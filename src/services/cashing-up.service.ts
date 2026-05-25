import { SupabaseClient } from '@supabase/supabase-js';
import {
  UpsertCashupSessionDTO,
  CashupSession,
  CashupDashboardData,
  CashupInsightsData,
  type CashupInsightsPeriod,
  type CashupSalesCategory,
} from '@/types/cashing-up';
import { addDays, endOfMonth, subDays, format, subMonths } from 'date-fns';
import { normalizeCashCountInputs } from '@/lib/cashing-up/cash-counts';

const SALES_CATEGORIES: CashupSalesCategory[] = ['drinks_sales', 'food_sales', 'other_sales'];
const SALES_CATEGORY_META: Record<CashupSalesCategory, { label: string; color: string }> = {
  drinks_sales: { label: 'Drinks', color: '#2563EB' },
  food_sales: { label: 'Food', color: '#16A34A' },
  other_sales: { label: 'Other', color: '#F59E0B' },
};
const INSIGHTS_PERIOD_DAYS: Record<Exclude<CashupInsightsPeriod, '12m'>, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

type CashupInsightsOptions = {
  year?: number;
  period?: CashupInsightsPeriod;
};
type ResolvedCashupInsightsOptions = {
  year?: number;
  period: CashupInsightsPeriod;
};

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function normaliseSalesBreakdowns(
  salesBreakdowns: UpsertCashupSessionDTO['salesBreakdowns']
): Array<{ sales_category: CashupSalesCategory; amount: number }> {
  if (!salesBreakdowns) return [];

  const amounts = new Map<CashupSalesCategory, number>(
    SALES_CATEGORIES.map((category) => [category, 0])
  );

  for (const item of salesBreakdowns) {
    if (!SALES_CATEGORIES.includes(item.salesCategory)) {
      throw new Error('Invalid sales split category');
    }

    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Sales split values must be valid positive numbers');
    }

    amounts.set(item.salesCategory, roundCurrency((amounts.get(item.salesCategory) ?? 0) + amount));
  }

  return SALES_CATEGORIES.map((category) => ({
    sales_category: category,
    amount: roundCurrency(amounts.get(category) ?? 0),
  }));
}

function assertSalesSplitMatchesTotal(totalCounted: number, salesRows: Array<{ amount: number }>) {
  const splitTotal = roundCurrency(salesRows.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const variance = roundCurrency(splitTotal - totalCounted);

  if (Math.abs(variance) > 0.01) {
    throw new Error('Sales split must match the total sales before submitting.');
  }
}

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`);
}

function monthKeyForDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthStartForDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function resolveInsightsOptions(input?: number | CashupInsightsOptions): ResolvedCashupInsightsOptions {
  if (typeof input === 'number') {
    return { year: input, period: '12m' };
  }

  return {
    year: input?.year,
    period: input?.period ?? '12m',
  };
}

function getInsightsDateWindow(options: ResolvedCashupInsightsOptions) {
  const today = new Date();

  if (options.year) {
    return {
      startDateStr: format(new Date(options.year, 0, 1), 'yyyy-MM-dd'),
      endDateStr: format(new Date(options.year, 11, 31), 'yyyy-MM-dd'),
    };
  }

  if (options.period === '12m') {
    return {
      startDateStr: format(monthStartForDate(subMonths(today, 11)), 'yyyy-MM-dd'),
      endDateStr: format(today, 'yyyy-MM-dd'),
    };
  }

  const dayCount = INSIGHTS_PERIOD_DAYS[options.period];
  return {
    startDateStr: format(subDays(today, dayCount - 1), 'yyyy-MM-dd'),
    endDateStr: format(today, 'yyyy-MM-dd'),
  };
}

function buildMonthBuckets(startDateStr: string, endDateStr: string, year?: number) {
  const buckets: Array<{ key: string; monthStart: string; monthLabel: string; date: Date }> = [];
  const startMonth = monthStartForDate(parseLocalDate(startDateStr));
  const endMonth = monthStartForDate(parseLocalDate(endDateStr));

  for (let date = startMonth; date <= endMonth; date = new Date(date.getFullYear(), date.getMonth() + 1, 1)) {
    buckets.push({
      key: monthKeyForDate(date),
      monthStart: format(date, 'yyyy-MM-dd'),
      monthLabel: date.toLocaleString('default', year ? { month: 'short' } : { month: 'short', year: '2-digit' }),
      date,
    });
  }

  return buckets;
}

function getJoinedSessionDate(row: { cashup_sessions?: { session_date?: string } | Array<{ session_date?: string }> }): string | null {
  const joinedSession = Array.isArray(row.cashup_sessions) ? row.cashup_sessions[0] : row.cashup_sessions;
  return joinedSession?.session_date ?? null;
}

export class CashingUpService {
  static async getInsightsData(supabase: SupabaseClient, siteId: string, optionsOrYear?: number | CashupInsightsOptions): Promise<CashupInsightsData> {
    // DEF-M02: use format() (local time) instead of toISOString() (UTC) to avoid date boundary shift
    const insightsOptions = resolveInsightsOptions(optionsOrYear);
    const { startDateStr, endDateStr } = getInsightsDateWindow(insightsOptions);
    const monthBuckets = buildMonthBuckets(startDateStr, endDateStr, insightsOptions.year);

    // Fetch Sessions and targets
    const [sessionsRes, targetsRes] = await Promise.all([
      supabase
        .from('cashup_sessions')
        .select('session_date, total_counted_amount, total_variance_amount')
        .eq('site_id', siteId)
        .gte('session_date', startDateStr)
        .lte('session_date', endDateStr),
      supabase
        .from('cashup_targets')
        .select('day_of_week, target_amount, effective_from')
        .eq('site_id', siteId)
        .lte('effective_from', endDateStr)
        .order('effective_from', { ascending: false }),
    ]);

    if (sessionsRes.error) throw sessionsRes.error;
    if (targetsRes.error) throw targetsRes.error;

    const sessions = sessionsRes.data ?? [];
    const targetRows = targetsRes.data ?? [];

    // Fetch Breakdowns for Payment Mix and Sales Mix
    const [paymentBreakdownsRes, salesBreakdownsRes, importedSalesRes] = await Promise.all([
      supabase
        .from('cashup_payment_breakdowns')
        .select('payment_type_label, counted_amount, cashup_sessions!inner(site_id, session_date)')
        .eq('cashup_sessions.site_id', siteId)
        .gte('cashup_sessions.session_date', startDateStr)
        .lte('cashup_sessions.session_date', endDateStr),
      supabase
        .from('cashup_sales_breakdowns')
        .select('sales_category, amount, cashup_sessions!inner(site_id, session_date)')
        .eq('cashup_sessions.site_id', siteId)
        .gte('cashup_sessions.session_date', startDateStr)
        .lte('cashup_sessions.session_date', endDateStr),
      supabase
        .from('pnl_sales_imports')
        .select('sale_date, drinks_sales, food_sales, other_sales')
        .eq('site_id', siteId)
        .eq('source', 'till_csv')
        .eq('source_section', 'Net sales')
        .gte('sale_date', startDateStr)
        .lte('sale_date', endDateStr),
    ]);

    if (paymentBreakdownsRes.error) throw paymentBreakdownsRes.error;
    if (salesBreakdownsRes.error) throw salesBreakdownsRes.error;
    if (importedSalesRes.error && !importedSalesRes.error.message.includes('pnl_sales_imports')) {
      throw importedSalesRes.error;
    }

    const breakdowns = paymentBreakdownsRes.data ?? [];
    const salesBreakdowns = salesBreakdownsRes.data ?? [];
    const importedSalesRows = importedSalesRes.error ? [] : (importedSalesRes.data ?? []);

    // --- 1. Day of Week Analysis ---
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats = new Map<number, { count: number; takings: number; variance: number }>();

    sessions?.forEach(s => {
      // DEF-M02: T12:00:00 prevents UTC midnight parsing from shifting the day-of-week
      const date = new Date(s.session_date + 'T12:00:00');
      const day = date.getDay();
      const current = dayStats.get(day) || { count: 0, takings: 0, variance: 0 };
      
      dayStats.set(day, {
        count: current.count + 1,
        takings: current.takings + (s.total_counted_amount || 0),
        variance: current.variance + (s.total_variance_amount || 0) // Use absolute variance? Usually net is better for "profitability", absolute for "risk". User asked for "Performance" and "Discrepancies". Let's keep signed variance for "Avg Variance" to see bias, but maybe magnitude elsewhere. Request says "Average Variance".
      });
    });

    // Sort by Monday (1) to Sunday (0) or standard week? Let's do Monday first.
    const sortedDays = [1, 2, 3, 4, 5, 6, 0]; 
    const dayOfWeekData = sortedDays.map(d => {
      const stats = dayStats.get(d) || { count: 0, takings: 0, variance: 0 };
      return {
        dayName: days[d],
        avgTakings: stats.count ? stats.takings / stats.count : 0,
        avgVariance: stats.count ? stats.variance / stats.count : 0
      };
    });

    // --- 2. Payment Mix ---
    const mixMap = new Map<string, number>();
    let totalMix = 0;

    breakdowns?.forEach(b => {
      const val = b.counted_amount || 0;
      const label = b.payment_type_label || 'Unknown';
      mixMap.set(label, (mixMap.get(label) || 0) + val);
      totalMix += val;
    });

    const paymentMixData = Array.from(mixMap.entries()).map(([label, value]) => ({
      label,
      value,
      percentage: totalMix ? (value / totalMix) * 100 : 0,
      color: label.toLowerCase().includes('cash') ? '#10B981' : (label.toLowerCase().includes('card') ? '#3B82F6' : '#F59E0B')
    })).sort((a, b) => b.value - a.value);

    // --- 3. Sales Mix ---
    const salesMixMap = new Map<CashupSalesCategory, number>(
      SALES_CATEGORIES.map((category) => [category, 0])
    );
    const salesMixMonthMap = new Map<string, Record<CashupSalesCategory, number>>(
      monthBuckets.map((bucket) => [
        bucket.key,
        { drinks_sales: 0, food_sales: 0, other_sales: 0 },
      ])
    );
    let totalSalesMix = 0;
    const addSalesMixAmount = (category: CashupSalesCategory, amount: number, dateStr?: string | null) => {
      const value = Number(amount || 0);
      salesMixMap.set(category, roundCurrency((salesMixMap.get(category) ?? 0) + value));
      totalSalesMix += value;

      if (!dateStr) return;
      const monthTotals = salesMixMonthMap.get(monthKeyForDate(parseLocalDate(dateStr)));
      if (!monthTotals) return;
      monthTotals[category] = roundCurrency(monthTotals[category] + value);
    };

    if (importedSalesRows.length > 0) {
      importedSalesRows.forEach((row) => {
        const drinksSales = Number(row.drinks_sales || 0);
        const foodSales = Number(row.food_sales || 0);
        const otherSales = Number(row.other_sales || 0);

        addSalesMixAmount('drinks_sales', drinksSales, row.sale_date);
        addSalesMixAmount('food_sales', foodSales, row.sale_date);
        addSalesMixAmount('other_sales', otherSales, row.sale_date);
      });
    } else {
      salesBreakdowns.forEach((breakdown) => {
        const category = breakdown.sales_category as CashupSalesCategory;
        if (!SALES_CATEGORIES.includes(category)) return;

        addSalesMixAmount(category, Number(breakdown.amount || 0), getJoinedSessionDate(breakdown));
      });
    }

    const salesMixData = SALES_CATEGORIES.map((category) => {
      const value = roundCurrency(salesMixMap.get(category) ?? 0);
      const meta = SALES_CATEGORY_META[category];

      return {
        label: meta.label,
        value,
        percentage: totalSalesMix ? (value / totalSalesMix) * 100 : 0,
        color: meta.color,
      };
    });
    const salesMixMonthlyData = monthBuckets.map((bucket) => {
      const totals = salesMixMonthMap.get(bucket.key) ?? { drinks_sales: 0, food_sales: 0, other_sales: 0 };
      const drinksSales = roundCurrency(totals.drinks_sales);
      const foodSales = roundCurrency(totals.food_sales);
      const otherSales = roundCurrency(totals.other_sales);
      const totalSales = roundCurrency(drinksSales + foodSales + otherSales);

      return {
        monthStart: bucket.monthStart,
        monthLabel: bucket.monthLabel,
        drinksSales,
        foodSales,
        otherSales,
        totalSales,
        drinksPercentage: totalSales ? (drinksSales / totalSales) * 100 : 0,
        foodPercentage: totalSales ? (foodSales / totalSales) * 100 : 0,
        otherPercentage: totalSales ? (otherSales / totalSales) * 100 : 0,
      };
    });

    // --- 4. Monthly Growth ---
    const monthStats = new Map<string, number>();
    
    sessions.forEach(s => {
      const d = new Date(s.session_date + 'T12:00:00');
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
      monthStats.set(key, (monthStats.get(key) || 0) + (s.total_counted_amount || 0));
    });

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayDate = new Date(todayStr + 'T12:00:00');
    const rangeStartDate = parseLocalDate(startDateStr);
    const rangeEndDate = parseLocalDate(endDateStr);
    const getTargetAmount = (dateStr: string): number => {
      const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();
      const match = targetRows.find(t => t.day_of_week === dayOfWeek && t.effective_from <= dateStr);
      return match ? Number(match.target_amount || 0) : 0;
    };
    const latestSessionDateByMonth = sessions.reduce((map, session) => {
      const d = new Date(session.session_date + 'T12:00:00');
      const key = monthKeyForDate(d);
      const current = map.get(key);
      if (!current || session.session_date > current) map.set(key, session.session_date);
      return map;
    }, new Map<string, string>());

    const getMonthlyTarget = (monthDate: Date) => {
      const key = monthKeyForDate(monthDate);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = endOfMonth(monthStart);
      const latestSessionDate = latestSessionDateByMonth.get(key);
      const isCurrentMonth = key === monthKeyForDate(todayDate);

      const targetStart = monthStart < rangeStartDate ? rangeStartDate : monthStart;
      let targetEnd = monthEnd > rangeEndDate ? rangeEndDate : monthEnd;

      if (targetStart > todayDate || targetStart > targetEnd) {
        return 0;
      }

      if (targetEnd > todayDate) {
        targetEnd = todayDate;
      }
      if (isCurrentMonth && latestSessionDate && latestSessionDate <= todayStr) {
        const latestDate = parseLocalDate(latestSessionDate);
        if (latestDate < targetEnd) targetEnd = latestDate;
      }

      let total = 0;
      for (let d = targetStart; d <= targetEnd; d = addDays(d, 1)) {
        total += getTargetAmount(format(d, 'yyyy-MM-dd'));
      }
      return total;
    };

    const monthlyGrowthData = monthBuckets.map((bucket) => ({
      monthLabel: bucket.monthLabel,
      totalTakings: monthStats.get(bucket.key) || 0,
      targetTakings: getMonthlyTarget(bucket.date),
    }));

    return {
      dayOfWeek: dayOfWeekData,
      paymentMix: paymentMixData,
      salesMix: salesMixData,
      salesMixMonthly: salesMixMonthlyData,
      monthlyGrowth: monthlyGrowthData
    };
  }

  static async getSession(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
      .from('cashup_sessions')
      .select(`
        *,
        cashup_payment_breakdowns (*),
        cashup_cash_counts (*),
        cashup_sales_breakdowns (*)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async getSessionByDateAndSite(supabase: SupabaseClient, siteId: string, sessionDate: string) {
    const { data, error } = await supabase
      .from('cashup_sessions')
      .select(`
        *,
        cashup_payment_breakdowns (*),
        cashup_cash_counts (*),
        cashup_sales_breakdowns (*)
      `)
      .eq('site_id', siteId)
      .eq('session_date', sessionDate)
      .maybeSingle(); // Use maybeSingle as a session might not exist
    
    if (error) throw error;
    return data;
  }

  static async upsertSession(supabase: SupabaseClient, data: UpsertCashupSessionDTO, userId: string, existingId?: string) {
    // Calculate totals
    const totalExpected = data.paymentBreakdowns.reduce((sum, item) => sum + item.expectedAmount, 0);
    const totalCounted = data.paymentBreakdowns.reduce((sum, item) => sum + item.countedAmount, 0);
    const totalVariance = totalCounted - totalExpected;
    const salesBreakdownRows = normaliseSalesBreakdowns(data.salesBreakdowns);

    if ((data.status ?? 'draft') !== 'draft') {
      assertSalesSplitMatchesTotal(totalCounted, salesBreakdownRows);
    }

    // Prepare session data
    const sessionData = {
      site_id: data.siteId,
      session_date: data.sessionDate,
      status: data.status || 'draft',
      notes: data.notes,
      total_expected_amount: totalExpected,
      total_counted_amount: totalCounted,
      total_variance_amount: totalVariance,
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    };

    let sessionId = existingId;
    const isNewSession = !sessionId; // DEF-C05: track for compensating delete on child insert failure

    if (!sessionId) {
      // Check for existing session to avoid constraint violation
      // We construct the query to match the unique index: site_id, session_date
      const { data: existing } = await supabase
        .from('cashup_sessions')
        .select('id')
        .eq('site_id', data.siteId)
        .eq('session_date', data.sessionDate)
        .maybeSingle();
        
      if (existing) {
        throw new Error('A session for this site and date already exists.');
      }
        
      // Insert
      const { data: newSession, error } = await supabase
        .from('cashup_sessions')
        .insert({
          ...sessionData,
          prepared_by_user_id: userId,
          created_by_user_id: userId,
        })
        .select('id')
        .single();
      
      if (error) throw error;
      sessionId = newSession.id;
    } else {
      // DEF-C06: guard against modifying locked sessions
      const { data: current } = await supabase
        .from('cashup_sessions')
        .select('status')
        .eq('id', sessionId)
        .single();
      if (current?.status === 'locked') throw new Error('Cannot modify a locked session');

      // Update
      const { data: updatedSession, error } = await supabase
        .from('cashup_sessions')
        .update(sessionData)
        .eq('id', sessionId)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!updatedSession) throw new Error('Session not found');
    }

    // Handle children (Replace strategy with compensating restore on failure — DEF-C05)
    // Fetch existing children before deleting so we can restore if insert fails
    const [existingBreakdownsRes, existingCountsRes, existingSalesRes] = await Promise.all([
      supabase.from('cashup_payment_breakdowns').select('*').eq('cashup_session_id', sessionId),
      supabase.from('cashup_cash_counts').select('*').eq('cashup_session_id', sessionId),
      supabase.from('cashup_sales_breakdowns').select('*').eq('cashup_session_id', sessionId),
    ]);
    const existingBreakdowns = existingBreakdownsRes.data ?? [];
    const existingCounts = existingCountsRes.data ?? [];
    const existingSales = existingSalesRes.data ?? [];

    const restoreOrRollbackChildren = async () => {
      if (isNewSession) {
        await supabase.from('cashup_sessions').delete().eq('id', sessionId).then(() => {}, () => {});
        return;
      }

      await Promise.all([
        supabase.from('cashup_payment_breakdowns').delete().eq('cashup_session_id', sessionId).then(() => {}, () => {}),
        supabase.from('cashup_cash_counts').delete().eq('cashup_session_id', sessionId).then(() => {}, () => {}),
        supabase.from('cashup_sales_breakdowns').delete().eq('cashup_session_id', sessionId).then(() => {}, () => {}),
      ]);

      await Promise.all([
        existingBreakdowns.length > 0
          ? supabase.from('cashup_payment_breakdowns').insert(existingBreakdowns).throwOnError()
          : Promise.resolve(),
        existingCounts.length > 0
          ? supabase.from('cashup_cash_counts').insert(existingCounts).throwOnError()
          : Promise.resolve(),
        existingSales.length > 0
          ? supabase.from('cashup_sales_breakdowns').insert(existingSales).throwOnError()
          : Promise.resolve(),
      ]);
    };

    // Delete existing
    const { error: deleteBreakdownsError } = await supabase
      .from('cashup_payment_breakdowns')
      .delete()
      .eq('cashup_session_id', sessionId);
    if (deleteBreakdownsError) throw deleteBreakdownsError;

    const { error: deleteCountsError } = await supabase
      .from('cashup_cash_counts')
      .delete()
      .eq('cashup_session_id', sessionId);
    if (deleteCountsError) throw deleteCountsError;

    const { error: deleteSalesError } = await supabase
      .from('cashup_sales_breakdowns')
      .delete()
      .eq('cashup_session_id', sessionId);
    if (deleteSalesError) throw deleteSalesError;

    // Insert new
    const breakdowns = data.paymentBreakdowns.map(b => ({
      cashup_session_id: sessionId,
      payment_type_code: b.paymentTypeCode,
      payment_type_label: b.paymentTypeLabel,
      expected_amount: b.expectedAmount,
      counted_amount: b.countedAmount,
      variance_amount: b.countedAmount - b.expectedAmount
    }));

    if (breakdowns.length > 0) {
      const { error: bdError } = await supabase.from('cashup_payment_breakdowns').insert(breakdowns);
      if (bdError) {
        await restoreOrRollbackChildren();
        throw bdError;
      }
    }

    const counts = normalizeCashCountInputs(data.cashCounts).map(c => ({
      cashup_session_id: sessionId,
      denomination: c.denomination,
      quantity: c.quantity,
      total_amount: c.totalAmount
    }));

    if (counts.length > 0) {
      const { error: cError } = await supabase.from('cashup_cash_counts').insert(counts);
      if (cError) {
        await restoreOrRollbackChildren();
        throw cError;
      }
    }

    if (data.salesBreakdowns) {
      const salesRows = salesBreakdownRows.map((item) => ({
        cashup_session_id: sessionId,
        sales_category: item.sales_category,
        amount: item.amount,
      }));

      const { error: salesError } = await supabase.from('cashup_sales_breakdowns').insert(salesRows);
      if (salesError) {
        await restoreOrRollbackChildren();
        throw salesError;
      }
    }

    return this.getSession(supabase, sessionId!);
  }

  static async validatePersistedSalesSplit(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
      .from('cashup_sessions')
      .select(`
        id,
        total_counted_amount,
        cashup_sales_breakdowns (
          sales_category,
          amount
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    const rows = (data?.cashup_sales_breakdowns ?? []) as Array<{ sales_category: CashupSalesCategory; amount: number }>;
    assertSalesSplitMatchesTotal(Number(data?.total_counted_amount ?? 0), rows);
  }

  static async submitSession(supabase: SupabaseClient, id: string, userId: string) {
    await this.validatePersistedSalesSplit(supabase, id);

    const { data: updatedRow, error } = await supabase
      .from('cashup_sessions')
      .update({ 
        status: 'submitted',
        approved_by_user_id: null,
        updated_by_user_id: userId, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .eq('status', 'draft') // Can only submit drafts
      .select('id')
      .maybeSingle();
    
    if (error) throw error;
    if (!updatedRow) throw new Error('Session not found or not in draft status');
    return this.getSession(supabase, id);
  }

  static async approveSession(supabase: SupabaseClient, id: string, userId: string) {
    await this.validatePersistedSalesSplit(supabase, id);

    const { data: updatedRow, error } = await supabase
      .from('cashup_sessions')
      .update({ 
        status: 'approved', 
        approved_by_user_id: userId,
        updated_by_user_id: userId, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .eq('status', 'submitted') // Can only approve submitted
      .select('id')
      .maybeSingle();
    
    if (error) throw error;
    if (!updatedRow) throw new Error('Session not found or not in submitted status');
    return this.getSession(supabase, id);
  }

  static async lockSession(supabase: SupabaseClient, id: string, userId: string) {
    await this.validatePersistedSalesSplit(supabase, id);

    const { data: updatedRow, error } = await supabase
      .from('cashup_sessions')
      .update({ status: 'locked', updated_by_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'approved') // DEF-C04: can only lock approved sessions
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!updatedRow) throw new Error('Session not found or not in approved status');
    return this.getSession(supabase, id);
  }

  static async unlockSession(supabase: SupabaseClient, id: string, userId: string) {
    const { data: updatedRow, error } = await supabase
      .from('cashup_sessions')
      .update({ status: 'approved', updated_by_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'locked')
      .select('id')
      .maybeSingle();
    
    if (error) throw error;
    if (!updatedRow) throw new Error('Session not found or not locked');
    return this.getSession(supabase, id);
  }

  static async getWeeklyData(supabase: SupabaseClient, siteId: string, weekStartDate: string) {
    // Compute the week end date (DEF-M02: use format() to avoid UTC toISOString shift)
    const weekEndDate = (() => {
      const d = new Date(weekStartDate + 'T12:00:00');
      d.setDate(d.getDate() + 6);
      return format(d, 'yyyy-MM-dd');
    })();

    // Fetch view rows and targets in parallel (N+1 fix: one targets query instead of per-row)
    const [viewRes, targetsRes] = await Promise.all([
      supabase
        .from('cashup_weekly_view')
        .select('*')
        .eq('site_id', siteId)
        .eq('week_start_date', weekStartDate)
        .order('session_date', { ascending: true }),
      supabase
        .from('cashup_targets')
        .select('day_of_week, target_amount, effective_from')
        .eq('site_id', siteId)
        .lte('effective_from', weekEndDate)
        .order('effective_from', { ascending: false }),
    ]);

    if (viewRes.error) throw viewRes.error;

    const targetRows = targetsRes.data ?? [];
    const getTargetAmount = (sessionDate: string): number => {
      const dow = new Date(sessionDate).getDay();
      const match = targetRows.find(t => t.day_of_week === dow && t.effective_from <= sessionDate);
      return match?.target_amount ?? 0;
    };

    return (viewRes.data ?? []).map((row) => {
      const target = getTargetAmount(row.session_date);
      return {
        ...row,
        target_amount: target,
        variance_vs_target: (row.total_counted_amount || 0) - target,
      };
    });
  }

  static async getDashboardData(supabase: SupabaseClient, siteId?: string, fromDate?: string, toDate?: string): Promise<CashupDashboardData> {
    // DEF-S01–S05: replaced stub values with real aggregations; fetch sites in parallel
    let sessionQuery = supabase
      .from('cashup_sessions')
      .select('total_counted_amount, total_variance_amount, session_date, site_id, status, notes, cashup_payment_breakdowns(payment_type_code, counted_amount)');
    if (siteId) sessionQuery = sessionQuery.eq('site_id', siteId);
    if (fromDate) sessionQuery = sessionQuery.gte('session_date', fromDate);
    if (toDate) sessionQuery = sessionQuery.lte('session_date', toDate);

    let targetQuery = supabase
      .from('cashup_targets')
      .select('site_id, day_of_week, target_amount, effective_from')
      .order('effective_from', { ascending: false });
    if (siteId) targetQuery = targetQuery.eq('site_id', siteId);

    const [{ data, error }, { data: allTargets }, { data: sites }] = await Promise.all([
      sessionQuery.order('session_date', { ascending: false }),
      targetQuery,
      supabase.from('sites').select('id, name'),
    ]);

    if (error) throw error;

    const sessions = data || [];
    const targetRows = allTargets ?? [];
    const siteMap = new Map<string, string>((sites ?? []).map(s => [s.id, s.name]));

    const getTargetAmountForSession = (sessionSiteId: string, sessionDate: string): number => {
      const dow = new Date(sessionDate + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift
      const match = targetRows.find(
        t => t.site_id === sessionSiteId && t.day_of_week === dow && t.effective_from <= sessionDate
      );
      return match?.target_amount ?? 0;
    };

    const getWeekStart = (sessionDate: string): Date => {
      const date = new Date(sessionDate + 'T12:00:00');
      const day = date.getDay();
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      date.setDate(date.getDate() - daysSinceMonday);
      return date;
    };

    const sessionsWithTarget = sessions.map((s) => {
      const target = getTargetAmountForSession(s.site_id, s.session_date);
      const breakdowns = (s.cashup_payment_breakdowns as any[]) || []; // any: Supabase doesn't narrow nested join types
      const cashTotal = breakdowns.find((b: any) => b.payment_type_code === 'CASH')?.counted_amount || 0;
      const cardTotal = breakdowns.find((b: any) => b.payment_type_code === 'CARD')?.counted_amount || 0;
      const stripeTotal = breakdowns.find((b: any) => b.payment_type_code === 'STRIPE')?.counted_amount || 0;
      return { ...s, target, cashTotal, cardTotal, stripeTotal };
    });

    const takingsBySiteDate = new Map<string, number>();
    for (const session of sessionsWithTarget) {
      takingsBySiteDate.set(
        `${session.site_id}|${session.session_date}`,
        (takingsBySiteDate.get(`${session.site_id}|${session.session_date}`) ?? 0) + (session.total_counted_amount || 0),
      );
    }

    const getAccruedTargetPerformance = (sessionSiteId: string, sessionDate: string) => {
      const weekStart = getWeekStart(sessionDate);
      const sessionDay = new Date(sessionDate + 'T12:00:00');
      let accruedTarget = 0;
      let accruedTakings = 0;

      for (let date = weekStart; date <= sessionDay; date = addDays(date, 1)) {
        const dateStr = format(date, 'yyyy-MM-dd');
        accruedTarget += getTargetAmountForSession(sessionSiteId, dateStr);
        accruedTakings += takingsBySiteDate.get(`${sessionSiteId}|${dateStr}`) ?? 0;
      }

      return {
        accruedTarget,
        accruedTakings,
        targetPerformancePercent: accruedTarget > 0 ? (accruedTakings / accruedTarget) * 100 : null,
      };
    };

    const totalTakings = sessionsWithTarget.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0);
    const totalTarget = sessionsWithTarget.reduce((sum, s) => sum + s.target, 0);
    const totalVariance = sessionsWithTarget.reduce((sum, s) => sum + (s.total_variance_amount || 0), 0);
    const sessionsWithTakings = sessionsWithTarget.filter(s => (s.total_counted_amount || 0) > 0);

    // DEF-S03: payment mix from in-memory breakdown data (no additional DB query needed)
    const mixMap = new Map<string, number>();
    for (const s of sessionsWithTarget) {
      mixMap.set('CASH', (mixMap.get('CASH') || 0) + s.cashTotal);
      mixMap.set('CARD', (mixMap.get('CARD') || 0) + s.cardTotal);
      mixMap.set('STRIPE', (mixMap.get('STRIPE') || 0) + s.stripeTotal);
    }
    const paymentMix = Array.from(mixMap.entries())
      .filter(([, v]) => v > 0)
      .map(([paymentTypeCode, amount]) => ({ paymentTypeCode, amount }));

    // DEF-S04: top sites by net variance, computed from in-memory data
    const siteVarianceMap = new Map<string, number>();
    for (const s of sessionsWithTarget) {
      siteVarianceMap.set(s.site_id, (siteVarianceMap.get(s.site_id) || 0) + (s.total_variance_amount || 0));
    }
    const topSitesByVariance = Array.from(siteVarianceMap.entries())
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 5)
      .map(([id, totalVariance]) => ({ siteId: id, siteName: siteMap.get(id) || id, totalVariance }));

    // DEF-S05: compliance grouped by site, counting submitted/approved days
    const complianceBySite = new Map<string, { submitted: number; approved: number; total: number }>();
    for (const s of sessionsWithTarget) {
      const entry = complianceBySite.get(s.site_id) || { submitted: 0, approved: 0, total: 0 };
      entry.total++;
      if (['submitted', 'approved', 'locked'].includes(s.status as string)) entry.submitted++;
      if (['approved', 'locked'].includes(s.status as string)) entry.approved++;
      complianceBySite.set(s.site_id, entry);
    }
    const compliance = Array.from(complianceBySite.entries()).map(([id, counts]) => ({
      siteId: id,
      siteName: siteMap.get(id) || id,
      expectedDays: counts.total,
      submittedDays: counts.submitted,
      approvedDays: counts.approved,
    }));

    // DEF-S01: expectedDays from explicit date range or fall back to actual session count
    const expectedDays = fromDate && toDate
      ? Math.round((new Date(toDate + 'T12:00:00').getTime() - new Date(fromDate + 'T12:00:00').getTime()) / 86400000) + 1
      : sessions.length;

    return {
      kpis: {
        totalTakings,
        totalTarget,
        averageDailyTakings: sessionsWithTakings.length ? totalTakings / sessionsWithTakings.length : 0,
        totalVariance,
        highVarianceDays: sessionsWithTarget.filter(s => Math.abs(s.total_variance_amount || 0) > 50).length,
        daysWithSubmittedSessions: sessions.length,
        expectedDays,
      },
      charts: {
        dailyTakings: sessionsWithTarget.map(s => ({ date: s.session_date, siteId: s.site_id, totalTakings: s.total_counted_amount, target: s.target })),
        dailyVariance: sessionsWithTarget.map(s => ({ date: s.session_date, totalVariance: s.total_variance_amount || 0 })),
        paymentMix, // DEF-S03: real data from breakdowns
        topSitesByVariance, // DEF-S04: real data aggregated by site
      },
      tables: {
        variance: sessionsWithTarget.map(s => {
          const targetPerformance = getAccruedTargetPerformance(s.site_id, s.session_date);

          return {
            siteId: s.site_id,
            siteName: siteMap.get(s.site_id) || s.site_id, // DEF-S02: real site name via sites join
            sessionDate: s.session_date,
            totalTakings: s.total_counted_amount,
            variance: s.total_variance_amount || 0,
            variancePercent: s.total_counted_amount ? ((s.total_variance_amount || 0) / s.total_counted_amount) * 100 : 0,
            status: s.status as any,
            notes: s.notes,
            cashTotal: s.cashTotal,
            cardTotal: s.cardTotal,
            stripeTotal: s.stripeTotal,
            dailyTarget: s.target,
            ...targetPerformance,
          };
        }),
        compliance, // DEF-S05: real compliance data
      },
    };
  }

  static async getDailyTarget(supabase: SupabaseClient, siteId: string, date: string): Promise<number> {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift
    
    const { data, error } = await supabase
      .from('cashup_targets')
      .select('target_amount')
      .eq('site_id', siteId)
      .eq('day_of_week', dayOfWeek)
      .lte('effective_from', date)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching daily target:', error);
      return 0;
    }

    return data?.target_amount || 0;
  }

  static async setDailyTarget(supabase: SupabaseClient, siteId: string, date: string, amount: number, userId: string) {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift

    // DEF-H06: upsert instead of insert to handle duplicate calls for same date
    const { error } = await supabase
      .from('cashup_targets')
      .upsert(
        {
          site_id: siteId,
          day_of_week: dayOfWeek,
          target_amount: amount,
          effective_from: date,
          created_by: userId,
        },
        { onConflict: 'site_id, day_of_week, effective_from' }
      );

    if (error) throw error;
    return true;
  }

  static async setWeeklyTargets(
    supabase: SupabaseClient, 
    siteId: string, 
    targets: { dayOfWeek: number; amount: number }[], 
    effectiveDate: string, 
    userId: string
  ) {
    const rows = targets.map(t => ({
      site_id: siteId,
      day_of_week: t.dayOfWeek,
      target_amount: t.amount,
      effective_from: effectiveDate,
      created_by: userId
    }));

    const { error } = await supabase
      .from('cashup_targets')
      .upsert(rows, { onConflict: 'site_id, day_of_week, effective_from' });

    if (error) throw error;
    return true;
  }

  static async getWeeklyProgress(supabase: SupabaseClient, siteId: string, date: string) {
    const requestedDate = new Date(date + 'T12:00:00'); // DEF-M02: noon avoids UTC boundary shift
    const day = requestedDate.getDay();
    const diff = requestedDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const weekStart = new Date(requestedDate);
    weekStart.setDate(diff);
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');

    const latestCompleted = subDays(new Date(), 1);
    const targetDate = requestedDate > latestCompleted ? latestCompleted : requestedDate;

    if (targetDate < weekStart) {
      return { weekStart: weekStartStr, dailyProgress: [] };
    }

    // Generate dates from Monday to the latest completed date for this week
    const dates: string[] = [];
    const d = new Date(weekStart);

    while (d <= targetDate) {
      dates.push(format(d, 'yyyy-MM-dd')); // DEF-M02: format() uses local time, not UTC
      d.setDate(d.getDate() + 1);
    }

    const fromStr = dates[0];
    const toStr = dates[dates.length - 1];
    const weekEndDate = toStr.split('T')[0];

    // Parallelise: fetch all targets and all sessions in one query each
    const dayOfWeeks = dates.map(ds => new Date(ds).getDay());
    const [targetsData, sessionsData] = await Promise.all([
      supabase
        .from('cashup_targets')
        .select('day_of_week, target_amount, effective_from')
        .eq('site_id', siteId)
        .in('day_of_week', [...new Set(dayOfWeeks)])
        .lte('effective_from', toStr)
        .order('effective_from', { ascending: false }),
      supabase
        .from('cashup_sessions')
        .select('session_date, total_counted_amount')
        .eq('site_id', siteId)
        .gte('session_date', fromStr)
        .lte('session_date', weekEndDate),
    ]);

    // Build a map of session_date -> total_counted_amount
    const sessionMap = new Map<string, number | null>();
    for (const s of sessionsData.data ?? []) {
      sessionMap.set(s.session_date, s.total_counted_amount ?? null);
    }

    // For each date, pick the most-recent target effective on or before that date
    const targetRows = targetsData.data ?? [];
    const getTargetAmount = (ds: string): number => {
      const dow = new Date(ds).getDay();
      const match = targetRows.find(t => t.day_of_week === dow && t.effective_from <= ds);
      return match?.target_amount ?? 0;
    };

    const progress = dates.map(dStr => ({
      date: dStr,
      target: getTargetAmount(dStr),
      actual: sessionMap.has(dStr) ? (sessionMap.get(dStr) ?? null) : null,
    }));

    return { weekStart: weekStartStr, dailyProgress: progress };
  }

  static async getWeeklyReportData(supabase: SupabaseClient, siteId: string, weekStartDate: string) {
    // 1. Generate all 7 dates for the week (DEF-M02: noon + format() avoids UTC boundary shift)
    const start = new Date(weekStartDate + 'T12:00:00');
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(format(d, 'yyyy-MM-dd'));
    }
    const endDate = dates[6];

    // 2. Fetch sessions and targets in parallel — one query each instead of N getDailyTarget() calls
    const dayOfWeeks = dates.map(ds => new Date(ds).getDay());
    const [sessionsRes, targetsRes] = await Promise.all([
      supabase
        .from('cashup_sessions')
        .select(`
          session_date,
          status,
          notes,
          total_expected_amount,
          total_counted_amount,
          total_variance_amount,
          cashup_payment_breakdowns (
            payment_type_code,
            expected_amount,
            counted_amount,
            variance_amount
          ),
          cashup_cash_counts (
            denomination,
            quantity,
            total_amount
          )
        `)
        .eq('site_id', siteId)
        .gte('session_date', weekStartDate)
        .lte('session_date', endDate)
        .order('session_date', { ascending: true }),
      supabase
        .from('cashup_targets')
        .select('day_of_week, target_amount, effective_from')
        .eq('site_id', siteId)
        .in('day_of_week', [...new Set(dayOfWeeks)])
        .lte('effective_from', endDate)
        .order('effective_from', { ascending: false }),
    ]);

    if (sessionsRes.error) throw sessionsRes.error;

    const sessions = sessionsRes.data ?? [];
    const targetRows = targetsRes.data ?? [];

    // Pick the most-recent target effective on or before each date
    const getTargetAmount = (ds: string): number => {
      const dow = new Date(ds).getDay();
      const match = targetRows.find(t => t.day_of_week === dow && t.effective_from <= ds);
      return match?.target_amount ?? 0;
    };

    // 3. Build targets array first so accumulation is deterministic
    const targets = dates.map(getTargetAmount);

    let runningTarget = 0;
    let runningRevenue = 0;

    return dates.map((date, index) => {
      const session = sessions?.find(s => s.session_date === date);
      const dailyTarget = targets[index];

      const cash = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'CASH');
      const card = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'CARD');
      const stripe = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'STRIPE');

      const totalActual = session?.total_counted_amount || 0;

      runningTarget += dailyTarget;
      runningRevenue += totalActual;

      return {
        date,
        status: session?.status || 'missing',
        notes: session?.notes || null,

        cash_expected: cash?.expected_amount || 0,
        cash_actual: cash?.counted_amount || 0,

        card_expected: card?.expected_amount || 0,
        card_actual: card?.counted_amount || 0,

        stripe_actual: stripe?.counted_amount || 0,

        total_expected: session?.total_expected_amount || 0,
        total_actual: totalActual,
        total_variance: session?.total_variance_amount || 0,

        daily_target: dailyTarget,
        accumulated_target: runningTarget,
        accumulated_revenue: runningRevenue,

        cash_counts: session?.cashup_cash_counts.map(c => ({
          denomination: c.denomination,
          total: c.total_amount
        })) || []
      };
    });
  }
}
