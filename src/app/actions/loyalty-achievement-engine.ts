'use server';

import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from './audit';

// Achievement criteria types
type AchievementCriteria = {
  type: 'event_count' | 'consecutive_events' | 'event_category' | 'points_earned' | 'tier_reached' | 'special_date' | 'custom';
  value?: number;
  category?: string;
  tier?: string;
  within_days?: number;
  special_dates?: string[];
};

// Check if a member has earned a specific achievement
async function checkAchievementCriteria(
  memberId: string,
  criteria: AchievementCriteria,
  supabase: any
): Promise<boolean> {
  try {
    switch (criteria.type) {
      case 'event_count': {
        // Check total event attendance
        const { count } = await supabase
          .from('event_check_ins')
          .select('*', { count: 'exact', head: true })
          .eq('member_id', memberId);
        
        return (count || 0) >= (criteria.value || 0);
      }

      case 'consecutive_events': {
        // Check consecutive event attendance
        const { data: checkIns } = await supabase
          .from('event_check_ins')
          .select('check_in_time, event:events(date)')
          .eq('member_id', memberId)
          .order('check_in_time', { ascending: false })
          .limit(criteria.value || 0);
        
        if (!checkIns || checkIns.length < (criteria.value || 0)) {
          return false;
        }
        
        // Check if events are consecutive (within reasonable timeframe)
        let consecutive = true;
        for (let i = 0; i < checkIns.length - 1; i++) {
          const current = new Date(checkIns[i].event.date);
          const next = new Date(checkIns[i + 1].event.date);
          const daysDiff = Math.abs(current.getTime() - next.getTime()) / (1000 * 60 * 60 * 24);
          
          // If more than 45 days between events, not consecutive
          if (daysDiff > 45) {
            consecutive = false;
            break;
          }
        }
        
        return consecutive;
      }

      case 'event_category': {
        // Check attendance at specific category events
        const { count } = await supabase
          .from('event_check_ins')
          .select(`
            *,
            event:events!inner(
              category:event_categories!inner(name)
            )
          `, { count: 'exact', head: true })
          .eq('member_id', memberId)
          .eq('event.category.name', criteria.category);
        
        return (count || 0) >= (criteria.value || 0);
      }

      case 'points_earned': {
        // Check total points earned
        const { data: member } = await supabase
          .from('loyalty_members')
          .select('lifetime_points')
          .eq('id', memberId)
          .single();
        
        return (member?.lifetime_points || 0) >= (criteria.value || 0);
      }

      case 'tier_reached': {
        // Check if member has reached a specific tier
        const { data: member } = await supabase
          .from('loyalty_members')
          .select('tier:loyalty_tiers(name)')
          .eq('id', memberId)
          .single();
        
        return member?.tier?.name === criteria.tier;
      }

      case 'special_date': {
        // Check attendance on special dates (e.g., Halloween, Christmas)
        const { count } = await supabase
          .from('event_check_ins')
          .select(`
            *,
            event:events!inner(date)
          `, { count: 'exact', head: true })
          .eq('member_id', memberId)
          .in('event.date', criteria.special_dates || []);
        
        return (count || 0) > 0;
      }

      case 'custom': {
        // Custom criteria - would need specific implementation
        return false;
      }

      default:
        return false;
    }
  } catch (error) {
    console.error('Error checking achievement criteria:', error);
    return false;
  }
}

// Check all achievements for a member
export async function checkMemberAchievements(memberId: string) {
  try {
    const supabase = await createClient();
    
    // Get all active achievements
    const { data: achievements, error: achievementsError } = await supabase
      .from('loyalty_achievements')
      .select('*')
      .eq('active', true);
    
    if (achievementsError || !achievements) {
      return { error: 'Failed to load achievements' };
    }
    
    // Get member's current achievements
    const { data: currentAchievements } = await supabase
      .from('customer_achievements')
      .select('achievement_id')
      .eq('member_id', memberId);
    
    const earnedAchievementIds = new Set(
      currentAchievements?.map(a => a.achievement_id) || []
    );
    
    const newAchievements = [];
    
    // Check each achievement
    for (const achievement of achievements) {
      // Skip if already earned
      if (earnedAchievementIds.has(achievement.id)) {
        continue;
      }
      
      // Check if criteria is met
      const criteriaObj = achievement.criteria as AchievementCriteria;
      const earned = await checkAchievementCriteria(memberId, criteriaObj, supabase);
      
      if (earned) {
        // Award achievement
        const { error: awardError } = await supabase
          .from('customer_achievements')
          .insert({
            member_id: memberId,
            achievement_id: achievement.id,
            points_awarded: achievement.points_value
          });
        
        if (!awardError) {
          newAchievements.push(achievement);
          
          // Award points if applicable
          if (achievement.points_value > 0) {
            // Get current points
            const { data: member } = await supabase
              .from('loyalty_members')
              .select('available_points, lifetime_points')
              .eq('id', memberId)
              .single();
            
            if (member) {
              // Update points
              await supabase
                .from('loyalty_members')
                .update({
                  available_points: member.available_points + achievement.points_value,
                  lifetime_points: member.lifetime_points + achievement.points_value
                })
                .eq('id', memberId);
              
              // Record transaction
              await supabase
                .from('loyalty_point_transactions')
                .insert({
                  member_id: memberId,
                  points: achievement.points_value,
                  balance_after: member.available_points + achievement.points_value,
                  transaction_type: 'achievement',
                  description: `Achievement unlocked: ${achievement.name}`,
                  reference_type: 'achievement',
                  reference_id: achievement.id
                });
            }
          }
          
          // Log audit event
          await logAuditEvent({
            operation_type: 'create',
            resource_type: 'achievement_earned',
            resource_id: achievement.id,
            operation_status: 'success',
            new_values: {
              member_id: memberId,
              achievement_name: achievement.name,
              points_awarded: achievement.points_value
            }
          });
        }
      }
    }
    
    return { 
      success: true, 
      newAchievements,
      totalChecked: achievements.length 
    };
  } catch (error) {
    console.error('Error checking achievements:', error);
    return { error: 'Failed to check achievements' };
  }
}

// Check achievements after specific events
export async function checkAchievementsAfterCheckIn(memberId: string, eventId: string) {
  try {
    const supabase = await createClient();
    
    // Get event details
    const { data: event } = await supabase
      .from('events')
      .select(`
        *,
        category:event_categories(name)
      `)
      .eq('id', eventId)
      .single();
    
    if (!event) {
      return { error: 'Event not found' };
    }
    
    // Run achievement checks
    const result = await checkMemberAchievements(memberId);
    
    return result;
  } catch (error) {
    console.error('Error checking achievements after check-in:', error);
    return { error: 'Failed to check achievements' };
  }
}

// Get member's achievement progress
export async function getMemberAchievementProgress(memberId: string) {
  try {
    const supabase = await createClient();
    
    // Get all achievements
    const { data: achievements } = await supabase
      .from('loyalty_achievements')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    
    // Get earned achievements
    const { data: earned } = await supabase
      .from('customer_achievements')
      .select('achievement_id, earned_date, points_awarded')
      .eq('member_id', memberId);
    
    const earnedMap = new Map(
      earned?.map(e => [e.achievement_id, e]) || []
    );
    
    // Get member stats for progress calculation
    const { data: member } = await supabase
      .from('loyalty_members')
      .select(`
        lifetime_events,
        lifetime_points,
        tier:loyalty_tiers(name)
      `)
      .eq('id', memberId)
      .single();
    
    // Calculate progress for each achievement
    const achievementProgress = await Promise.all(
      achievements?.map(async (achievement) => {
        const isEarned = earnedMap.has(achievement.id);
        const earnedData = earnedMap.get(achievement.id);
        
        let progress = 0;
        let progressText = '';
        
        if (!isEarned) {
          const criteria = achievement.criteria as AchievementCriteria;
          
          switch (criteria.type) {
            case 'event_count':
              progress = Math.min(100, ((member?.lifetime_events || 0) / (criteria.value || 1)) * 100);
              progressText = `${member?.lifetime_events || 0}/${criteria.value} events`;
              break;
              
            case 'points_earned':
              progress = Math.min(100, ((member?.lifetime_points || 0) / (criteria.value || 1)) * 100);
              progressText = `${member?.lifetime_points || 0}/${criteria.value} points`;
              break;
              
            case 'event_category':
              const { count } = await supabase
                .from('event_check_ins')
                .select(`
                  *,
                  event:events!inner(
                    category:event_categories!inner(name)
                  )
                `, { count: 'exact', head: true })
                .eq('member_id', memberId)
                .eq('event.category.name', criteria.category);
              
              progress = Math.min(100, ((count || 0) / (criteria.value || 1)) * 100);
              progressText = `${count || 0}/${criteria.value} ${criteria.category} events`;
              break;
          }
        }
        
        return {
          ...achievement,
          isEarned,
          earnedDate: earnedData?.earned_date,
          pointsAwarded: earnedData?.points_awarded,
          progress,
          progressText
        };
      }) || []
    );
    
    // Group by category
    const grouped = achievementProgress.reduce((acc, achievement) => {
      const category = achievement.category || 'general';
      if (!acc[category]) acc[category] = [];
      acc[category].push(achievement);
      return acc;
    }, {} as Record<string, typeof achievementProgress>);
    
    return {
      data: {
        achievements: achievementProgress,
        grouped,
        stats: {
          total: achievements?.length || 0,
          earned: earned?.length || 0,
          percentage: Math.round(((earned?.length || 0) / (achievements?.length || 1)) * 100),
          totalPoints: earned?.reduce((sum, e) => sum + (e.points_awarded || 0), 0) || 0
        }
      }
    };
  } catch (error) {
    console.error('Error getting achievement progress:', error);
    return { error: 'Failed to load achievement progress' };
  }
}

// Initialize default achievements
export async function initializeDefaultAchievements() {
  try {
    const supabase = await createClient();
    
    // Get active program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();
    
    if (!program) {
      return { error: 'No active loyalty program found' };
    }
    
    const defaultAchievements = [
      // Attendance achievements
      {
        name: 'First Timer',
        description: 'Attend your first event',
        icon: '🎯',
        points_value: 50,
        criteria: { type: 'event_count', value: 1 },
        category: 'attendance',
        sort_order: 1
      },
      {
        name: 'Regular',
        description: 'Attend 5 events',
        icon: '⭐',
        points_value: 100,
        criteria: { type: 'event_count', value: 5 },
        category: 'attendance',
        sort_order: 2
      },
      {
        name: 'Loyal Customer',
        description: 'Attend 10 events',
        icon: '🏆',
        points_value: 200,
        criteria: { type: 'event_count', value: 10 },
        category: 'attendance',
        sort_order: 3
      },
      {
        name: 'VIP Regular',
        description: 'Attend 25 events',
        icon: '👑',
        points_value: 500,
        criteria: { type: 'event_count', value: 25 },
        category: 'attendance',
        sort_order: 4
      },
      
      // Streak achievements
      {
        name: 'Hot Streak',
        description: 'Attend 3 events in a row',
        icon: '🔥',
        points_value: 150,
        criteria: { type: 'consecutive_events', value: 3 },
        category: 'streaks',
        sort_order: 10
      },
      {
        name: 'On Fire',
        description: 'Attend 5 events in a row',
        icon: '🌟',
        points_value: 300,
        criteria: { type: 'consecutive_events', value: 5 },
        category: 'streaks',
        sort_order: 11
      },
      
      // Category achievements
      {
        name: 'Quiz Master',
        description: 'Attend 5 Quiz Night events',
        icon: '🧠',
        points_value: 200,
        criteria: { type: 'event_category', value: 5, category: 'Quiz Night' },
        category: 'special',
        sort_order: 20
      },
      {
        name: 'Karaoke Star',
        description: 'Attend 5 Karaoke events',
        icon: '🎤',
        points_value: 200,
        criteria: { type: 'event_category', value: 5, category: 'Karaoke' },
        category: 'special',
        sort_order: 21
      },
      {
        name: 'Bingo Champion',
        description: 'Attend 5 Bingo events',
        icon: '🎱',
        points_value: 200,
        criteria: { type: 'event_category', value: 5, category: 'Bingo' },
        category: 'special',
        sort_order: 22
      },
      
      // Points achievements
      {
        name: 'Point Collector',
        description: 'Earn 500 total points',
        icon: '💰',
        points_value: 100,
        criteria: { type: 'points_earned', value: 500 },
        category: 'points',
        sort_order: 30
      },
      {
        name: 'Point Hoarder',
        description: 'Earn 1000 total points',
        icon: '💎',
        points_value: 200,
        criteria: { type: 'points_earned', value: 1000 },
        category: 'points',
        sort_order: 31
      },
      {
        name: 'Point Millionaire',
        description: 'Earn 2500 total points',
        icon: '🏅',
        points_value: 500,
        criteria: { type: 'points_earned', value: 2500 },
        category: 'points',
        sort_order: 32
      },
      
      // Tier achievements
      {
        name: 'Silver Status',
        description: 'Reach Silver tier',
        icon: '🥈',
        points_value: 150,
        criteria: { type: 'tier_reached', tier: 'Silver' },
        category: 'tiers',
        sort_order: 40
      },
      {
        name: 'Gold Status',
        description: 'Reach Gold tier',
        icon: '🥇',
        points_value: 300,
        criteria: { type: 'tier_reached', tier: 'Gold' },
        category: 'tiers',
        sort_order: 41
      },
      {
        name: 'Platinum Status',
        description: 'Reach Platinum tier',
        icon: '💎',
        points_value: 500,
        criteria: { type: 'tier_reached', tier: 'Platinum' },
        category: 'tiers',
        sort_order: 42
      }
    ];
    
    // Insert achievements
    for (const achievement of defaultAchievements) {
      await supabase
        .from('loyalty_achievements')
        .upsert({
          program_id: program.id,
          ...achievement
        }, {
          onConflict: 'program_id,name'
        });
    }
    
    return { success: true, badge: defaultAchievements.length };
  } catch (error) {
    console.error('Error initializing achievements:', error);
    return { error: 'Failed to initialize achievements' };
  }
}