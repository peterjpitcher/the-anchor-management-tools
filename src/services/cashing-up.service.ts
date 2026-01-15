import { SupabaseClient } from '@supabase/supabase-js';
import { UpsertCashupSessionDTO, CashupSession, CashupDashboardData, CashupInsightsData } from '@/types/cashing-up';
import { subDays } from 'date-fns';

export class CashingUpService {
  static async getInsightsData(supabase: SupabaseClient, siteId: string, year?: number): Promise<CashupInsightsData> {
    let startDate: Date;
    let endDate: Date;

    if (year) {
        startDate = new Date(year, 0, 1); // Jan 1st of the year
        endDate = new Date(year, 11, 31); // Dec 31st of the year
    } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 12); // Last 12 months
    }

    // Fetch Sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('cashup_sessions')
      .select('session_date, total_counted_amount, total_variance_amount')
      .eq('site_id', siteId)
      .gte('session_date', startDate.toISOString().split('T')[0])
      .lte('session_date', endDate.toISOString().split('T')[0]);

    if (sessionError) throw sessionError;

    // Fetch Breakdowns for Payment Mix
    const { data: breakdowns, error: bdError } = await supabase
      .from('cashup_payment_breakdowns')
      .select('payment_type_label, counted_amount, cashup_sessions!inner(site_id, session_date)')
      .eq('cashup_sessions.site_id', siteId)
      .gte('cashup_sessions.session_date', startDate.toISOString().split('T')[0])
      .lte('cashup_sessions.session_date', endDate.toISOString().split('T')[0]);

    if (bdError) throw bdError;

    // --- 1. Day of Week Analysis ---
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats = new Map<number, { count: number; takings: number; variance: number }>();

    sessions?.forEach(s => {
      const date = new Date(s.session_date);
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
      // Update
      const { error } = await supabase
        .from('cashup_sessions')
        .update(sessionData)
        .eq('id', sessionId);
      
      if (error) throw error;
    }

    // Handle children (Replace strategy)
    // Delete existing
    await supabase.from('cashup_payment_breakdowns').delete().eq('cashup_session_id', sessionId);
    await supabase.from('cashup_cash_counts').delete().eq('cashup_session_id', sessionId);

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
      if (bdError) throw bdError;
    }

    const counts = data.cashCounts.map(c => ({
      cashup_session_id: sessionId,
      denomination: c.denomination,
      quantity: c.quantity,
      total_amount: c.denomination * c.quantity
    }));

    if (counts.length > 0) {
      const { error: cError } = await supabase.from('cashup_cash_counts').insert(counts);
      if (cError) throw cError;
    }

    return this.getSession(supabase, sessionId!);
  }

  static async submitSession(supabase: SupabaseClient, id: string, userId: string) {
    // validations can be added here
    const { error } = await supabase
      .from('cashup_sessions')
      .update({ 
        status: 'approved', 
        approved_by_user_id: userId,
        updated_by_user_id: userId, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .eq('status', 'draft'); // Can only submit drafts
    
    if (error) throw error;
    return this.getSession(supabase, id);
  }

  static async approveSession(supabase: SupabaseClient, id: string, userId: string) {
    const { error } = await supabase
      .from('cashup_sessions')
      .update({ 
        status: 'approved', 
        approved_by_user_id: userId,
        updated_by_user_id: userId, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .eq('status', 'submitted'); // Can only approve submitted
    
    if (error) throw error;
    return this.getSession(supabase, id);
  }

  static async lockSession(supabase: SupabaseClient, id: string, userId: string) {
    const { error } = await supabase
      .from('cashup_sessions')
      .update({ status: 'locked', updated_by_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id);
    
    if (error) throw error;
    return this.getSession(supabase, id);
  }

  static async unlockSession(supabase: SupabaseClient, id: string, userId: string) {
    const { error } = await supabase
      .from('cashup_sessions')
      .update({ status: 'approved', updated_by_user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'locked');
    
    if (error) throw error;
    return this.getSession(supabase, id);
  }

  static async getWeeklyData(supabase: SupabaseClient, siteId: string, weekStartDate: string) {
    // Using the view
    const { data, error } = await supabase
      .from('cashup_weekly_view')
      .select('*')
      .eq('site_id', siteId)
      .eq('week_start_date', weekStartDate)
      .order('session_date', { ascending: true });

    if (error) throw error;

    // Augment with target data
    const augmentedData = await Promise.all(data.map(async (row) => {
      const target = await this.getDailyTarget(supabase, siteId, row.session_date);
      return {
        ...row,
        target_amount: target,
        variance_vs_target: (row.total_counted_amount || 0) - target
      };
    }));

    return augmentedData;
  }

  static async getDashboardData(supabase: SupabaseClient, siteId?: string, fromDate?: string, toDate?: string): Promise<CashupDashboardData> {
    // This would be complex SQL or multiple queries.
    // For Foundation/Discovery, returning mock structure or basic aggregations.
    
    // Example: Total Takings
    let query = supabase.from('cashup_sessions').select('total_counted_amount, total_variance_amount, session_date, site_id, status, notes, cashup_payment_breakdowns(payment_type_code, counted_amount)');
    
    if (siteId) query = query.eq('site_id', siteId);
    if (fromDate) query = query.gte('session_date', fromDate);
    if (toDate) query = query.lte('session_date', toDate);
    
    const { data, error } = await query.order('session_date', { ascending: false });
    
    if (error) throw error;

    const sessions = data || [];
    
    // Augment sessions with Target data
    const sessionsWithTarget = await Promise.all(sessions.map(async (s) => {
      const target = await this.getDailyTarget(supabase, s.site_id, s.session_date);
      const varianceVsTarget = (s.total_counted_amount || 0) - target;

      // Calculate breakdown totals
      const breakdowns = s.cashup_payment_breakdowns || [];
      const cashTotal = breakdowns.find((b: any) => b.payment_type_code === 'CASH')?.counted_amount || 0;
      const cardTotal = breakdowns.find((b: any) => b.payment_type_code === 'CARD')?.counted_amount || 0;
      const stripeTotal = breakdowns.find((b: any) => b.payment_type_code === 'STRIPE')?.counted_amount || 0;

      return {
        ...s,
        target,
        varianceVsTarget,
        cashTotal,
        cardTotal,
        stripeTotal
      };
    }));

    const totalTakings = sessionsWithTarget.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0);
    const totalTarget = sessionsWithTarget.reduce((sum, s) => sum + (s.target || 0), 0);
    // Use stored total_variance_amount (Counted - Expected) instead of variance vs target
    const totalVariance = sessionsWithTarget.reduce((sum, s) => sum + (s.total_variance_amount || 0), 0);
    
    // Filter for days with actual takings to calculate meaningful average (excludes "Closed" days)
    const sessionsWithTakings = sessionsWithTarget.filter(s => (s.total_counted_amount || 0) > 0);

    return {
      kpis: {
        totalTakings,
        totalTarget,
        averageDailyTakings: sessionsWithTakings.length ? totalTakings / sessionsWithTakings.length : 0,
        totalVariance,
        // High variance days based on actual cash discrepancy, not target
        highVarianceDays: sessionsWithTarget.filter(s => Math.abs(s.total_variance_amount || 0) > 50).length, 
        daysWithSubmittedSessions: sessions.length,
        expectedDays: 28 // Mock
      },
      charts: {
        dailyTakings: sessionsWithTarget.map(s => ({ date: s.session_date, siteId: s.site_id, totalTakings: s.total_counted_amount, target: s.target })),
        // Use stored variance (discrepancy)
        dailyVariance: sessionsWithTarget.map(s => ({ date: s.session_date, totalVariance: s.total_variance_amount || 0 })),
        paymentMix: [], // Requires joining breakdowns
        topSitesByVariance: []
      },
      tables: {
        variance: sessionsWithTarget.map(s => ({
          siteId: s.site_id,
          siteName: 'Site', // Need join
          sessionDate: s.session_date,
          totalTakings: s.total_counted_amount,
          // Use stored variance (discrepancy)
          variance: s.total_variance_amount || 0,
          // Percent of Taking? Or vs Expected? Let's do vs Counted for now or 0 if 0.
          variancePercent: s.total_counted_amount ? ((s.total_variance_amount || 0) / s.total_counted_amount) * 100 : 0,
          status: s.status as any,
          notes: s.notes,
          cashTotal: s.cashTotal,
          cardTotal: s.cardTotal,
          stripeTotal: s.stripeTotal
        })),
        compliance: []
      }
    };
  }

  static async getDailyTarget(supabase: SupabaseClient, siteId: string, date: string): Promise<number> {
    const dayOfWeek = new Date(date).getDay();
    
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
    const dayOfWeek = new Date(date).getDay();
    
    const { error } = await supabase
      .from('cashup_targets')
      .insert({
        site_id: siteId,
        day_of_week: dayOfWeek,
        target_amount: amount,
        effective_from: date,
        created_by: userId
      });

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
    const requestedDate = new Date(date);
    const day = requestedDate.getDay();
    const diff = requestedDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const weekStart = new Date(requestedDate);
    weekStart.setDate(diff);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const latestCompleted = subDays(new Date(), 1);
    const targetDate = requestedDate > latestCompleted ? latestCompleted : requestedDate;

    if (targetDate < weekStart) {
      return { weekStart: weekStartStr, dailyProgress: [] };
    }

    // Generate dates from Monday to the latest completed date for this week
    const dates: string[] = [];
    const d = new Date(weekStart);
    
    while (d <= targetDate) {
      dates.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }

    const progress = [];

    for (const dStr of dates) {
      // Get Target
      const target = await this.getDailyTarget(supabase, siteId, dStr);

      // Get Actual
      const { data: session } = await supabase
        .from('cashup_sessions')
        .select('total_counted_amount')
        .eq('site_id', siteId)
        .eq('session_date', dStr)
        .maybeSingle();

      progress.push({
        date: dStr,
        target,
        actual: session?.total_counted_amount ?? null
      });
    }

    return { weekStart: weekStartStr, dailyProgress: progress };
  }

  static async getWeeklyReportData(supabase: SupabaseClient, siteId: string, weekStartDate: string) {
    // 1. Generate all 7 dates for the week
    const start = new Date(weekStartDate);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    const endDate = dates[6];
    
    // 2. Fetch sessions for the week
    const { data: sessions, error } = await supabase
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
      .order('session_date', { ascending: true });

    if (error) throw error;

    let accumulatedTarget = 0;
    let accumulatedRevenue = 0;

    // 3. Process each day
    const reportRows = await Promise.all(dates.map(async (date) => {
      const session = sessions?.find(s => s.session_date === date);
      
      // Get Target
      const dailyTarget = await this.getDailyTarget(supabase, siteId, date);
      
      // Values
      const cash = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'CASH');
      const card = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'CARD');
      const stripe = session?.cashup_payment_breakdowns.find(b => b.payment_type_code === 'STRIPE');

      const totalActual = session?.total_counted_amount || 0;
      
      // Accumulate (only if day has passed? Or target accumulates regardless? 
      // The image shows accumulation for future days? No, image dates are July 2025 (past). 
      // Let's accumulate everything.)
      accumulatedTarget += dailyTarget;
      accumulatedRevenue += totalActual;

      return {
        date,
        status: session?.status || 'missing',
        notes: session?.notes || null,
        
        // Cash
        cash_expected: cash?.expected_amount || 0,
        cash_actual: cash?.counted_amount || 0,
        
        // Card
        card_expected: card?.expected_amount || 0,
        card_actual: card?.counted_amount || 0,
        
        // Stripe
        stripe_actual: stripe?.counted_amount || 0,
        
        // Totals
        total_expected: session?.total_expected_amount || 0,
        total_actual: totalActual,
        total_variance: session?.total_variance_amount || 0,
        
        // Targets
        daily_target: dailyTarget,
        accumulated_target: accumulatedTarget,
        accumulated_revenue: accumulatedRevenue,
        
        // Breakdowns
        cash_counts: session?.cashup_cash_counts.map(c => ({
          denomination: c.denomination,
          total: c.total_amount
        })) || []
      };
    }));

    // Re-calculate accumulation sequentially because Promise.all runs in parallel and order of completion isn't guaranteed, 
    // BUT map maintains order of result array. 
    // HOWEVER, the `accumulatedTarget +=` inside the callback is dangerous in Promise.all because of race conditions on the variable 
    // if not careful? Actually JS is single threaded so `await` yields.
    // Correct approach: Fetch targets first, then map synchronously to accumulate.
    
    // Revised Logic below:
    
    // A. Fetch all targets first to avoid async issues in loop or slow sequential awaits
    const targets = await Promise.all(dates.map(d => this.getDailyTarget(supabase, siteId, d)));
    
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
