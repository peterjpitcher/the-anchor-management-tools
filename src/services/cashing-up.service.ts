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

  static async upsertSession(supabase: SupabaseClient, data: UpsertCashupSessionDTO, userId: string, existingId?: string) {
    // Calculate totals
    const totalExpected = data.paymentBreakdowns.reduce((sum, item) => sum + item.expectedAmount, 0);
    const totalCounted = data.paymentBreakdowns.reduce((sum, item) => sum + item.countedAmount, 0);
    const totalVariance = totalCounted - totalExpected;

    // Prepare session data
    const sessionData = {
      site_id: data.siteId,
      session_date: data.sessionDate,
      shift_code: data.shiftCode || null,
      status: data.status || 'draft',
      notes: data.notes,
      workbook_payload: data.workbookPayload || {},
      total_expected_amount: totalExpected,
      total_counted_amount: totalCounted,
      total_variance_amount: totalVariance,
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    };

    let sessionId = existingId;

    if (!sessionId) {
      // Check for existing session to avoid constraint violation
      // We construct the query to match the unique index: site_id, session_date, shift_code
      let query = supabase
        .from('cashup_sessions')
        .select('id')
        .eq('site_id', data.siteId)
        .eq('session_date', data.sessionDate);
      
      if (data.shiftCode) {
        query = query.eq('shift_code', data.shiftCode);
      } else {
        query = query.is('shift_code', null);
      }

      const { data: existing } = await query.maybeSingle();
        
      if (existing) {
        throw new Error('A session for this site, date and shift already exists.');
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
    return data;
  }

  static async getDashboardData(supabase: SupabaseClient, siteId?: string, fromDate?: string, toDate?: string): Promise<CashupDashboardData> {
    // This would be complex SQL or multiple queries.
    // For Foundation/Discovery, returning mock structure or basic aggregations.
    
    // Example: Total Takings
    let query = supabase.from('cashup_sessions').select('total_counted_amount, total_variance_amount, session_date, site_id, status');
    
    if (siteId) query = query.eq('site_id', siteId);
    if (fromDate) query = query.gte('session_date', fromDate);
    if (toDate) query = query.lte('session_date', toDate);
    
    const { data, error } = await query;
    
    if (error) throw error;

    const sessions = data || [];
    const totalTakings = sessions.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0);
    const totalVariance = sessions.reduce((sum, s) => sum + (s.total_variance_amount || 0), 0);
    
    return {
      kpis: {
        totalTakings,
        averageDailyTakings: sessions.length ? totalTakings / sessions.length : 0,
        totalVariance,
        highVarianceDays: sessions.filter(s => Math.abs(s.total_variance_amount) > 5).length, // threshold example
        daysWithSubmittedSessions: sessions.length,
        expectedDays: 28 // Mock
      },
      charts: {
        dailyTakings: sessions.map(s => ({ date: s.session_date, siteId: s.site_id, totalTakings: s.total_counted_amount })),
        dailyVariance: sessions.map(s => ({ date: s.session_date, totalVariance: s.total_variance_amount })),
        paymentMix: [], // Requires joining breakdowns
        topSitesByVariance: []
      },
      tables: {
        variance: sessions.map(s => ({
          siteId: s.site_id,
          siteName: 'Site', // Need join
          sessionDate: s.session_date,
          totalTakings: s.total_counted_amount,
          variance: s.total_variance_amount,
          variancePercent: 0,
          status: s.status as any,
          notes: null
        })),
        compliance: []
      }
    };
  }
}
