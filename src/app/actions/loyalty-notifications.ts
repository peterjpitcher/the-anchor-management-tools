'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { JobQueue } from '@/lib/background-jobs';

// Validation schemas
const LoyaltyNotificationSchema = z.object({
  member_id: z.string().uuid(),
  type: z.enum(['welcome', 'tier_upgrade', 'achievement', 'points_earned', 'reward_available', 'challenge_update']),
  data: z.record(z.any()).optional()
});

const BulkNotificationSchema = z.object({
  member_ids: z.array(z.string().uuid()).optional(),
  tier_ids: z.array(z.string().uuid()).optional(),
  type: z.enum(['campaign', 'event_reminder', 'reward_announcement', 'challenge_announcement']),
  message: z.string().min(1).max(160),
  schedule_for: z.string().datetime().optional()
});

// Internal function for system-initiated notifications (no permission check)
async function sendLoyaltyNotificationInternal(data: z.infer<typeof LoyaltyNotificationSchema>) {
  try {
    const supabase = await createClient();
    
    // Validate input
    const validatedData = LoyaltyNotificationSchema.parse(data);
    
    // Get member details with customer info
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers(
          id,
          name,
          phone_number
        ),
        tier:loyalty_tiers(
          name,
          icon
        )
      `)
      .eq('id', validatedData.member_id)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    if (!member.customer?.phone_number) {
      return { error: 'Member has no phone number' };
    }
    
    // Check if customer has opted in for SMS
    const { data: health } = await supabase
      .from('customer_messaging_health')
      .select('sms_suspended')
      .eq('customer_id', member.customer.id)
      .single();
    
    if (health?.sms_suspended) {
      return { error: 'Customer has opted out of SMS messages' };
    }
    
    // Generate message based on notification type
    let message = '';
    
    switch (validatedData.type) {
      case 'welcome':
        message = `Welcome to The Anchor VIP Club, ${member.customer.name}! You've earned ${validatedData.data?.welcome_points || 50} points. Start earning rewards at every visit!`;
        break;
        
      case 'tier_upgrade':
        message = `Congratulations ${member.customer.name}! You've been upgraded to ${validatedData.data?.new_tier} status. Enjoy ${validatedData.data?.multiplier}x points on all visits!`;
        break;
        
      case 'achievement':
        message = `Achievement unlocked! ${validatedData.data?.achievement_name} - ${validatedData.data?.achievement_description}. ${validatedData.data?.points_earned || 0} bonus points awarded!`;
        break;
        
      case 'points_earned':
        message = `Thanks for visiting The Anchor, ${member.customer.name}! You earned ${validatedData.data?.points} points. Your balance: ${validatedData.data?.new_balance} points.`;
        break;
        
      case 'reward_available':
        message = `Great news ${member.customer.name}! You have enough points to redeem: ${validatedData.data?.reward_name}. Visit us to claim your reward!`;
        break;
        
      case 'challenge_update':
        message = `Challenge update: ${validatedData.data?.challenge_name} - ${validatedData.data?.progress}% complete. ${validatedData.data?.message || 'Keep going!'}`;
        break;
    }
    
    // Queue the SMS
    const jobQueue = JobQueue.getInstance();
    const jobId = await jobQueue.enqueue('send_sms', {
      to: member.customer.phone_number,
      message,
      customerId: member.customer.id,
      type: 'custom'
    });
    
    // Record in loyalty notifications table
    const { error: notificationError } = await supabase
      .from('loyalty_notifications')
      .insert({
        member_id: validatedData.member_id,
        notification_type: validatedData.type,
        channel: 'sms',
        content: message,
        metadata: validatedData.data,
        job_id: jobId
      });
    
    if (notificationError) {
      console.error('Failed to record notification:', notificationError);
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_notification',
      resource_id: validatedData.member_id,
      operation_status: 'success',
      new_values: {
        type: validatedData.type,
        channel: 'sms'
      }
    });
    
    return { success: true, jobId, message };
  } catch (error) {
    console.error('Error sending loyalty notification:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to send notification' };
  }
}

// Public function with permission check
export async function sendLoyaltyNotification(data: z.infer<typeof LoyaltyNotificationSchema>) {
  const hasPermission = await checkUserPermission('loyalty', 'manage');
  if (!hasPermission) {
    return { error: 'You do not have permission to send notifications' };
  }
  
  return sendLoyaltyNotificationInternal(data);
}

// Export internal function for system use (e.g., enrollment, automated notifications)
export { sendLoyaltyNotificationInternal };

// Send bulk notifications to loyalty members
export async function sendBulkLoyaltyNotification(data: z.infer<typeof BulkNotificationSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to send bulk notifications' };
    }
    
    // Validate input
    const validatedData = BulkNotificationSchema.parse(data);
    
    // Build query for target members
    let query = supabase
      .from('loyalty_members')
      .select(`
        id,
        customer:customers!inner(
          id,
          name,
          phone_number
        )
      `)
      .eq('status', 'active');
    
    if (validatedData.member_ids && validatedData.member_ids.length > 0) {
      query = query.in('id', validatedData.member_ids);
    }
    
    if (validatedData.tier_ids && validatedData.tier_ids.length > 0) {
      query = query.in('tier_id', validatedData.tier_ids);
    }
    
    const { data: members, error: membersError } = await query;
    
    if (membersError || !members) {
      return { error: 'Failed to fetch target members' };
    }
    
    // Filter out members without phone numbers or who have opted out
    const validMembers: any[] = [];
    for (const member of members) {
      // Handle the case where customer could be an array or object
      const customer = Array.isArray(member.customer) ? member.customer[0] : member.customer;
      
      if (!customer || !customer.phone_number) {
        continue;
      }
      
      const { data: health } = await supabase
        .from('customer_messaging_health')
        .select('sms_suspended')
        .eq('customer_id', customer.id)
        .single();
      
      if (!health?.sms_suspended) {
        validMembers.push({
          ...member,
          customer // Ensure we have the normalized customer object
        });
      }
    }
    
    if (validMembers.length === 0) {
      return { error: 'No valid recipients found' };
    }
    
    // Queue bulk SMS job
    const jobQueue = JobQueue.getInstance();
    const jobId = await jobQueue.enqueue('send_bulk_sms', {
      customerIds: validMembers.map(m => m.customer.id),
      message: validatedData.message
    }, {
      delay: validatedData.schedule_for 
        ? new Date(validatedData.schedule_for).getTime() - Date.now()
        : undefined
    });
    
    // Record bulk notification
    const { error: notificationError } = await supabase
      .from('loyalty_bulk_notifications')
      .insert({
        notification_type: validatedData.type,
        message: validatedData.message,
        recipient_count: validMembers.length,
        filter_criteria: {
          member_ids: validatedData.member_ids,
          tier_ids: validatedData.tier_ids
        },
        scheduled_for: validatedData.schedule_for,
        job_id: jobId
      });
    
    if (notificationError) {
      console.error('Failed to record bulk notification:', notificationError);
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_bulk_notification',
      resource_id: jobId,
      operation_status: 'success',
      new_values: {
        type: validatedData.type,
        recipient_count: validMembers.length,
        scheduled: !!validatedData.schedule_for
      }
    });
    
    return { 
      success: true, 
      jobId, 
      recipientCount: validMembers.length,
      message: validatedData.message 
    };
  } catch (error) {
    console.error('Error sending bulk notification:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to send bulk notification' };
  }
}

// Send automated notifications based on events
export async function sendAutomatedLoyaltyNotifications() {
  try {
    const supabase = await createClient();
    
    // Get notification settings
    const { data: settings } = await supabase
      .from('loyalty_programs')
      .select('settings')
      .eq('active', true)
      .single();
    
    if (!settings?.settings?.automated_notifications) {
      return { message: 'Automated notifications disabled' };
    }
    
    const notifications = settings.settings.automated_notifications;
    const jobQueue = JobQueue.getInstance();
    let sentCount = 0;
    
    // Welcome messages for new members (joined in last 24 hours)
    if (notifications.welcome_enabled) {
      const { data: newMembers } = await supabase
        .from('loyalty_members')
        .select(`
          id,
          customer:customers(name)
        `)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .is('welcome_sent', null);
      
      for (const member of newMembers || []) {
        await sendLoyaltyNotificationInternal({
          member_id: member.id,
          type: 'welcome',
          data: {
            welcome_points: settings.settings.welcome_bonus || 50
          }
        });
        
        // Mark welcome as sent
        await supabase
          .from('loyalty_members')
          .update({ welcome_sent: true })
          .eq('id', member.id);
        
        sentCount++;
      }
    }
    
    // Reward availability notifications
    if (notifications.reward_available_enabled) {
      const { data: eligibleMembers } = await supabase
        .from('loyalty_members')
        .select(`
          id,
          available_points,
          customer:customers(name),
          last_reward_notification
        `)
        .gt('available_points', 100); // Minimum points for rewards
      
      for (const member of eligibleMembers || []) {
        // Check if we've sent a notification recently (within 7 days)
        if (member.last_reward_notification) {
          const lastSent = new Date(member.last_reward_notification);
          if (Date.now() - lastSent.getTime() < 7 * 24 * 60 * 60 * 1000) {
            continue;
          }
        }
        
        // Find available rewards
        const { data: availableRewards } = await supabase
          .from('loyalty_rewards')
          .select('name, points_cost')
          .lte('points_cost', member.available_points)
          .eq('active', true)
          .order('points_cost', { ascending: false })
          .limit(1);
        
        if (availableRewards && availableRewards.length > 0) {
          await sendLoyaltyNotificationInternal({
            member_id: member.id,
            type: 'reward_available',
            data: {
              reward_name: availableRewards[0].name,
              points_cost: availableRewards[0].points_cost
            }
          });
          
          // Update last notification date
          await supabase
            .from('loyalty_members')
            .update({ last_reward_notification: new Date().toISOString() })
            .eq('id', member.id);
          
          sentCount++;
        }
      }
    }
    
    return { 
      success: true, 
      sentCount,
      message: `Processed ${sentCount} automated notifications` 
    };
  } catch (error) {
    console.error('Error processing automated notifications:', error);
    return { error: 'Failed to process automated notifications' };
  }
}

// Get notification history for a member
export async function getMemberNotificationHistory(memberId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view notifications' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_notifications')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load notification history' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading notification history:', error);
    return { error: 'An unexpected error occurred' };
  }
}