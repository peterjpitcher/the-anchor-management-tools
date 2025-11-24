import { SupabaseClient } from '@supabase/supabase-js';
import { UpsertCashupSessionDTO, CashupSession, CashupDashboardData } from '@/types/cashing-up';

export class CashingUpService {
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
      .update({ status: 'submitted', updated_by_user_id: userId, updated_at: new Date().toISOString() })
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
    
    const { data, error } = await query;
    
    if (error) throw error;

    const sessions = data || [];
    
    // Augment sessions with Target data
    const sessionsWithTarget = await Promise.all(sessions.map(async (s) => {
      const target = await this.getDailyTarget(supabase, s.site_id, s.session_date);
      const varianceVsTarget = (s.total_counted_amount || 0) - target;

      // Calculate breakdown totals
      const breakdowns = s.cashup_payment_breakdowns || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cashTotal = breakdowns.find((b: any) => b.payment_type_code === 'CASH')?.counted_amount || 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cardTotal = breakdowns.find((b: any) => b.payment_type_code === 'CARD')?.counted_amount || 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // Use stored total_variance_amount (Counted - Expected) instead of variance vs target
    const totalVariance = sessionsWithTarget.reduce((sum, s) => sum + (s.total_variance_amount || 0), 0);
    
    // Filter for days with actual takings to calculate meaningful average (excludes "Closed" days)
    const sessionsWithTakings = sessionsWithTarget.filter(s => (s.total_counted_amount || 0) > 0);

    return {
      kpis: {
        totalTakings,
        averageDailyTakings: sessionsWithTakings.length ? totalTakings / sessionsWithTakings.length : 0,
        totalVariance,
        // High variance days based on actual cash discrepancy, not target
        highVarianceDays: sessionsWithTarget.filter(s => Math.abs(s.total_variance_amount || 0) > 50).length, 
        daysWithSubmittedSessions: sessions.length,
        expectedDays: 28 // Mock
      },
      charts: {
        dailyTakings: sessionsWithTarget.map(s => ({ date: s.session_date, siteId: s.site_id, totalTakings: s.total_counted_amount })),
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
    const current = new Date(date);
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const weekStart = new Date(current.setDate(diff));
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Generate dates from Monday to Current Date
    const dates: string[] = [];
    const d = new Date(weekStart);
    const targetDate = new Date(date);
    
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
