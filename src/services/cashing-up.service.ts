import { SupabaseClient } from '@supabase/supabase-js';
import { UpsertCashupSessionDTO, CashupSession, CashupDashboardData, CashupInsightsData } from '@/types/cashing-up';
import { subDays, format, subMonths } from 'date-fns';

export class CashingUpService {
  static async getInsightsData(supabase: SupabaseClient, siteId: string, year?: number): Promise<CashupInsightsData> {
    // DEF-M02: use format() (local time) instead of toISOString() (UTC) to avoid date boundary shift
    let startDateStr: string;
    let endDateStr: string;

    if (year) {
        startDateStr = format(new Date(year, 0, 1), 'yyyy-MM-dd'); // Jan 1st of the year
        endDateStr = format(new Date(year, 11, 31), 'yyyy-MM-dd'); // Dec 31st of the year
    } else {
        endDateStr = format(new Date(), 'yyyy-MM-dd');
        startDateStr = format(subMonths(new Date(), 12), 'yyyy-MM-dd'); // Last 12 months
    }

    // Fetch Sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('cashup_sessions')
      .select('session_date, total_counted_amount, total_variance_amount')
      .eq('site_id', siteId)
      .gte('session_date', startDateStr)
      .lte('session_date', endDateStr);

    if (sessionError) throw sessionError;

    // Fetch Breakdowns for Payment Mix
    const { data: breakdowns, error: bdError } = await supabase
      .from('cashup_payment_breakdowns')
      .select('payment_type_label, counted_amount, cashup_sessions!inner(site_id, session_date)')
      .eq('cashup_sessions.site_id', siteId)
      .gte('cashup_sessions.session_date', startDateStr)
      .lte('cashup_sessions.session_date', endDateStr);

    if (bdError) throw bdError;

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

    // --- 3. Monthly Growth ---
    const monthStats = new Map<string, number>();
    
    sessions?.forEach(s => {
      const d = new Date(s.session_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
      monthStats.set(key, (monthStats.get(key) || 0) + (s.total_counted_amount || 0));
    });

    const monthlyGrowthData = [];
    
    if (year) {
        // Generate all 12 months for the specific year
        for (let i = 0; i < 12; i++) {
            const d = new Date(year, i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = d.toLocaleString('default', { month: 'short' });
            
            monthlyGrowthData.push({
                monthLabel,
                totalTakings: monthStats.get(key) || 0
            });
        }
    } else {
        // Generate last 12 months keys to ensure continuity
        for (let i = 11; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            
            monthlyGrowthData.push({
                monthLabel,
                totalTakings: monthStats.get(key) || 0
            });
        }
    }

    return {
      dayOfWeek: dayOfWeekData,
      paymentMix: paymentMixData,
      monthlyGrowth: monthlyGrowthData
    };
  }

  static async getSession(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
      .from('cashup_sessions')
      .select(`
        *,
        cashup_payment_breakdowns (*),
        cashup_cash_counts (*)
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
        cashup_cash_counts (*)
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
    const [existingBreakdownsRes, existingCountsRes] = await Promise.all([
      supabase.from('cashup_payment_breakdowns').select('*').eq('cashup_session_id', sessionId),
      supabase.from('cashup_cash_counts').select('*').eq('cashup_session_id', sessionId),
    ]);
    const existingBreakdowns = existingBreakdownsRes.data ?? [];
    const existingCounts = existingCountsRes.data ?? [];

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
        if (isNewSession) {
          // New session: compensating delete of orphaned session header
          await supabase.from('cashup_sessions').delete().eq('id', sessionId).then(() => {}, () => {});
        } else {
          // Existing session: attempt to restore original children
          await Promise.all([
            existingBreakdowns.length > 0
              ? supabase.from('cashup_payment_breakdowns').insert(existingBreakdowns).throwOnError()
              : Promise.resolve(),
            existingCounts.length > 0
              ? supabase.from('cashup_cash_counts').insert(existingCounts).throwOnError()
              : Promise.resolve(),
          ]);
        }
        throw bdError;
      }
    }

    const counts = data.cashCounts.map(c => ({
      cashup_session_id: sessionId,
      denomination: c.denomination,
      quantity: c.quantity,
      total_amount: c.denomination * c.quantity
    }));

    if (counts.length > 0) {
      const { error: cError } = await supabase.from('cashup_cash_counts').insert(counts);
      if (cError) {
        if (isNewSession) {
          // New session: compensating delete of orphaned session header (breakdowns already inserted ok)
          await supabase.from('cashup_sessions').delete().eq('id', sessionId).then(() => {}, () => {});
        } else {
          // Existing session: attempt to restore original counts
          if (existingCounts.length > 0) {
            await supabase.from('cashup_cash_counts').insert(existingCounts).throwOnError();
          }
        }
        throw cError;
      }
    }

    return this.getSession(supabase, sessionId!);
  }

  static async submitSession(supabase: SupabaseClient, id: string, userId: string) {
    // validations can be added here
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

    const sessionsWithTarget = sessions.map((s) => {
      const target = getTargetAmountForSession(s.site_id, s.session_date);
      const breakdowns = (s.cashup_payment_breakdowns as any[]) || []; // any: Supabase doesn't narrow nested join types
      const cashTotal = breakdowns.find((b: any) => b.payment_type_code === 'CASH')?.counted_amount || 0;
      const cardTotal = breakdowns.find((b: any) => b.payment_type_code === 'CARD')?.counted_amount || 0;
      const stripeTotal = breakdowns.find((b: any) => b.payment_type_code === 'STRIPE')?.counted_amount || 0;
      return { ...s, target, cashTotal, cardTotal, stripeTotal };
    });

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
        variance: sessionsWithTarget.map(s => ({
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
        })),
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
