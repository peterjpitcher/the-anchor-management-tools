'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';

// Get member's transaction history
export async function getMemberTransactions(memberId: string, limit = 50) {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('loyalty_point_transactions')
      .select(`
        *,
        created_by:auth.users(email)
      `)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load transaction history' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading transactions:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get all transactions (for admin)
export async function getAllTransactions(filters?: {
  member_id?: string;
  transaction_type?: string;
  start_date?: string;
  end_date?: string;
}) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view transactions' };
    }
    
    let query = supabase
      .from('loyalty_point_transactions')
      .select(`
        *,
        member:loyalty_members(
          customer:customers(name, phone_number)
        ),
        created_by:auth.users(email)
      `)
      .order('created_at', { ascending: false });
    
    // Apply filters
    if (filters?.member_id) {
      query = query.eq('member_id', filters.member_id);
    }
    if (filters?.transaction_type) {
      query = query.eq('transaction_type', filters.transaction_type);
    }
    if (filters?.start_date) {
      query = query.gte('created_at', filters.start_date);
    }
    if (filters?.end_date) {
      query = query.lte('created_at', filters.end_date);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load transactions' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading transactions:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get transaction statistics
export async function getTransactionStats(memberId?: string) {
  try {
    const supabase = await createClient();
    
    let query;
    
    if (memberId) {
      query = supabase.from('loyalty_point_transactions').select('*').eq('member_id', memberId);
    } else {
      const hasPermission = await checkUserPermission('loyalty', 'view');
      if (!hasPermission) {
        return { error: 'You do not have permission to view statistics' };
      }
      query = supabase.from('loyalty_point_transactions').select('*');
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load statistics' };
    }
    
    // Calculate statistics
    const stats = {
      totalTransactions: data.length,
      totalPointsEarned: 0,
      totalPointsSpent: 0,
      byType: {} as Record<string, number>,
      recentActivity: [] as any[]
    };
    
    data.forEach(transaction => {
      if (transaction.points > 0) {
        stats.totalPointsEarned += transaction.points;
      } else {
        stats.totalPointsSpent += Math.abs(transaction.points);
      }
      
      stats.byType[transaction.transaction_type] = 
        (stats.byType[transaction.transaction_type] || 0) + 1;
    });
    
    stats.recentActivity = data.slice(0, 10);
    
    return { data: stats };
  } catch (error) {
    console.error('Error calculating stats:', error);
    return { error: 'An unexpected error occurred' };
  }
}