'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { z } from 'zod';

// Date range schema
const DateRangeSchema = z.object({
  range: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
  customStart: z.string().datetime().optional(),
  customEnd: z.string().datetime().optional()
});

// Get comprehensive loyalty analytics
export async function getLoyaltyAnalytics(params: z.infer<typeof DateRangeSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view analytics' };
    }
    
    // Validate input
    const { range } = DateRangeSchema.parse(params);
    
    // Calculate date range
    const now = new Date();
    const startDate = new Date();
    
    switch (range) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    // Get active program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();
    
    if (!program) {
      return { error: 'No active loyalty program' };
    }
    
    // Member metrics
    const { count: totalMembers } = await supabase
      .from('loyalty_members')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', program.id);
    
    const { count: newMembersThisWeek } = await supabase
      .from('loyalty_members')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    const { count: activeMembers } = await supabase
      .from('loyalty_members')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .gte('last_visit_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    // Calculate growth rate (compared to previous period)
    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setMonth(startDate.getMonth() - 1);
    
    const { count: previousMembers } = await supabase
      .from('loyalty_members')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .lte('created_at', previousPeriodStart.toISOString());
    
    const memberGrowthRate = previousMembers 
      ? ((totalMembers! - previousMembers) / previousMembers * 100)
      : 0;
    
    // Tier distribution
    const { data: tierData } = await supabase
      .from('loyalty_members')
      .select('tier:loyalty_tiers!inner(name)')
      .eq('program_id', program.id);
    
    const tierDistribution = tierData?.reduce((acc, member) => {
      // Handle the tier data which could be an object or array
      const tier = Array.isArray(member.tier) ? member.tier[0] : member.tier;
      const tierName = tier?.name?.toLowerCase() || 'member';
      acc[tierName] = (acc[tierName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Engagement metrics
    const { data: checkIns } = await supabase
      .from('event_check_ins')
      .select('*')
      .gte('check_in_time', startDate.toISOString());
    
    const totalCheckIns = checkIns?.length || 0;
    
    // Get unique members who checked in
    const uniqueCheckInMembers = new Set(checkIns?.map(c => c.member_id).filter(Boolean));
    const averageVisitsPerMember = uniqueCheckInMembers.size > 0 
      ? totalCheckIns / uniqueCheckInMembers.size 
      : 0;
    
    // Calculate check-in rate (bookings that checked in)
    const { count: totalBookings } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDate.toISOString());
    
    const checkInRate = totalBookings ? (totalCheckIns / totalBookings * 100) : 0;
    
    // Points metrics
    const { data: pointsData } = await supabase
      .from('loyalty_point_transactions')
      .select('points, transaction_type')
      .gte('created_at', startDate.toISOString());
    
    const totalPointsIssued = pointsData
      ?.filter(t => t.points > 0)
      .reduce((sum, t) => sum + t.points, 0) || 0;
    
    const totalPointsRedeemed = Math.abs(pointsData
      ?.filter(t => t.points < 0)
      .reduce((sum, t) => sum + t.points, 0) || 0);
    
    const redemptionRate = totalPointsIssued > 0 
      ? (totalPointsRedeemed / totalPointsIssued * 100)
      : 0;
    
    const { data: memberPoints } = await supabase
      .from('loyalty_members')
      .select('available_points')
      .eq('program_id', program.id);
    
    const averagePointsPerMember = memberPoints && memberPoints.length > 0
      ? memberPoints.reduce((sum, m) => sum + (m.available_points || 0), 0) / memberPoints.length
      : 0;
    
    // Most popular rewards
    const { data: redemptions } = await supabase
      .from('reward_redemptions')
      .select(`
        reward:loyalty_rewards!inner(name, category)
      `)
      .eq('status', 'redeemed')
      .gte('redeemed_at', startDate.toISOString());
    
    const rewardCounts = redemptions?.reduce((acc, r) => {
      // Handle the reward data which could be an object or array
      const reward = Array.isArray(r.reward) ? r.reward[0] : r.reward;
      const rewardName = reward?.name || 'Unknown';
      if (!acc[rewardName]) {
        acc[rewardName] = {
          name: rewardName,
          redemptions: 0,
          category: reward?.category || 'other'
        };
      }
      acc[rewardName].redemptions++;
      return acc;
    }, {} as Record<string, any>) || {};
    
    const mostPopularRewards = Object.values(rewardCounts)
      .sort((a: any, b: any) => b.redemptions - a.redemptions)
      .slice(0, 5);
    
    // Check-ins by day of week
    const checkInsByDayOfWeek = checkIns?.reduce((acc, checkIn) => {
      const day = new Date(checkIn.check_in_time).toLocaleDateString('en-US', { weekday: 'long' });
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Check-ins by hour
    const checkInsByHour = checkIns?.reduce((acc, checkIn) => {
      const hour = new Date(checkIn.check_in_time).getHours().toString();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Monthly trends (last 6 months)
    const monthlyTrends = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      const { count: monthMembers } = await supabase
        .from('loyalty_members')
        .select('*', { count: 'exact', head: true })
        .eq('program_id', program.id)
        .lte('created_at', monthEnd.toISOString());
      
      const { count: monthCheckIns } = await supabase
        .from('event_check_ins')
        .select('*', { count: 'exact', head: true })
        .gte('check_in_time', monthStart.toISOString())
        .lt('check_in_time', monthEnd.toISOString());
      
      const { data: monthPoints } = await supabase
        .from('loyalty_point_transactions')
        .select('points')
        .gte('created_at', monthStart.toISOString())
        .lt('created_at', monthEnd.toISOString())
        .gt('points', 0);
      
      const monthPointsTotal = monthPoints?.reduce((sum, t) => sum + t.points, 0) || 0;
      
      monthlyTrends.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short' }),
        members: monthMembers || 0,
        checkIns: monthCheckIns || 0,
        points: monthPointsTotal
      });
    }
    
    return {
      data: {
        totalMembers: totalMembers || 0,
        newMembersThisWeek: newMembersThisWeek || 0,
        memberGrowthRate,
        tierDistribution,
        activeMembers: activeMembers || 0,
        averageVisitsPerMember,
        checkInRate,
        totalPointsIssued,
        totalPointsRedeemed,
        redemptionRate,
        averagePointsPerMember,
        mostPopularRewards,
        checkInsByDayOfWeek,
        checkInsByHour,
        monthlyTrends
      }
    };
  } catch (error) {
    console.error('Error loading analytics:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to load analytics' };
  }
}

// Get member engagement metrics
export async function getMemberEngagementMetrics() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view analytics' };
    }
    
    // Engagement cohorts
    const { data: members } = await supabase
      .from('loyalty_members')
      .select(`
        id,
        created_at,
        lifetime_events,
        last_visit_date,
        available_points
      `);
    
    if (!members) {
      return { error: 'Failed to load member data' };
    }
    
    const now = new Date();
    const cohorts = {
      veryActive: 0,    // Visited in last 7 days
      active: 0,        // Visited in last 30 days
      occasional: 0,    // Visited in last 90 days
      dormant: 0,       // Not visited in 90+ days
      new: 0           // Joined in last 30 days
    };
    
    members.forEach(member => {
      const joinDate = new Date(member.created_at);
      const lastVisit = member.last_visit_date ? new Date(member.last_visit_date) : null;
      const daysSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24);
      const daysSinceVisit = lastVisit 
        ? (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;
      
      if (daysSinceJoin <= 30) {
        cohorts.new++;
      } else if (daysSinceVisit <= 7) {
        cohorts.veryActive++;
      } else if (daysSinceVisit <= 30) {
        cohorts.active++;
      } else if (daysSinceVisit <= 90) {
        cohorts.occasional++;
      } else {
        cohorts.dormant++;
      }
    });
    
    // Visit frequency distribution
    const visitFrequency = members.reduce((acc, member) => {
      const visits = member.lifetime_events || 0;
      if (visits === 0) acc['0']++;
      else if (visits === 1) acc['1']++;
      else if (visits <= 5) acc['2-5']++;
      else if (visits <= 10) acc['6-10']++;
      else if (visits <= 20) acc['11-20']++;
      else acc['20+']++;
      return acc;
    }, {
      '0': 0,
      '1': 0,
      '2-5': 0,
      '6-10': 0,
      '11-20': 0,
      '20+': 0
    });
    
    // Points balance distribution
    const pointsDistribution = members.reduce((acc, member) => {
      const points = member.available_points || 0;
      if (points === 0) acc['0']++;
      else if (points <= 50) acc['1-50']++;
      else if (points <= 100) acc['51-100']++;
      else if (points <= 200) acc['101-200']++;
      else if (points <= 500) acc['201-500']++;
      else acc['500+']++;
      return acc;
    }, {
      '0': 0,
      '1-50': 0,
      '51-100': 0,
      '101-200': 0,
      '201-500': 0,
      '500+': 0
    });
    
    return {
      data: {
        engagementCohorts: cohorts,
        visitFrequency,
        pointsDistribution,
        totalMembers: members.length
      }
    };
  } catch (error) {
    console.error('Error loading engagement metrics:', error);
    return { error: 'Failed to load engagement metrics' };
  }
}

// Get campaign performance metrics
export async function getCampaignPerformanceMetrics() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view analytics' };
    }
    
    // Get active campaigns
    const { data: campaigns } = await supabase
      .from('loyalty_campaigns')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (!campaigns) {
      return { data: { campaigns: [] } };
    }
    
    // Calculate performance for each campaign
    const campaignMetrics = await Promise.all(
      campaigns.map(async (campaign) => {
        // Get check-ins during campaign period
        const { count: checkIns } = await supabase
          .from('event_check_ins')
          .select('*', { count: 'exact', head: true })
          .gte('check_in_time', campaign.start_date)
          .lte('check_in_time', campaign.end_date);
        
        // Get points earned during campaign
        const { data: pointsData } = await supabase
          .from('loyalty_point_transactions')
          .select('points')
          .gte('created_at', campaign.start_date)
          .lte('created_at', campaign.end_date)
          .gt('points', 0);
        
        const totalPoints = pointsData?.reduce((sum, t) => sum + t.points, 0) || 0;
        
        // Calculate bonus points if multiplier campaign
        let bonusPoints = 0;
        if (campaign.bonus_type === 'multiplier') {
          bonusPoints = totalPoints * (campaign.bonus_value - 1);
        }
        
        return {
          ...campaign,
          metrics: {
            checkIns: checkIns || 0,
            totalPoints,
            bonusPoints,
            daysRemaining: Math.max(0, 
              Math.ceil((new Date(campaign.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            )
          }
        };
      })
    );
    
    return { data: { campaigns: campaignMetrics } };
  } catch (error) {
    console.error('Error loading campaign metrics:', error);
    return { error: 'Failed to load campaign metrics' };
  }
}