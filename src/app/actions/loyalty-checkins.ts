'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

// Validation schemas
const CheckInSchema = z.object({
  event_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  booking_id: z.string().uuid().optional(),
  check_in_method: z.enum(['qr', 'manual', 'self']).default('manual'),
  notes: z.string().optional()
});

const QRCodeSchema = z.object({
  event_id: z.string().uuid(),
  booking_id: z.string().uuid()
});

// Generate a unique QR code for a booking
export async function generateBookingQRCode(eventId: string, bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Validate input
    const validatedData = QRCodeSchema.parse({ event_id: eventId, booking_id: bookingId });
    
    // Generate a secure token for the QR code
    const token = crypto.randomBytes(32).toString('hex');
    const qrData = {
      type: 'loyalty_checkin',
      event_id: validatedData.event_id,
      booking_id: validatedData.booking_id,
      token: token,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };
    
    // Store the token in the booking record
    const { error } = await supabase
      .from('bookings')
      .update({ 
        qr_token: token,
        qr_expires_at: qrData.expires
      })
      .eq('id', bookingId);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to generate QR code' };
    }
    
    // Return the QR code data
    return { 
      success: true, 
      qrData: JSON.stringify(qrData),
      qrUrl: `${process.env.NEXT_PUBLIC_APP_URL}/loyalty/checkin?data=${encodeURIComponent(Buffer.from(JSON.stringify(qrData)).toString('base64'))}`
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Process event check-in
export async function processEventCheckIn(data: z.infer<typeof CheckInSchema>) {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission && data.check_in_method !== 'self') {
      return { error: 'You do not have permission to check in customers' };
    }
    
    // Validate input
    const validatedData = CheckInSchema.parse(data);
    
    // Get the current user
    const { data: { user } } = await supabase.auth.getUser();
    
    // Call the database function to process check-in
    const { data: result, error } = await adminSupabase
      .rpc('process_event_check_in', {
        p_event_id: validatedData.event_id,
        p_customer_id: validatedData.customer_id,
        p_booking_id: validatedData.booking_id,
        p_check_in_method: validatedData.check_in_method,
        p_staff_id: user?.id,
        p_notes: validatedData.notes
      });
    
    if (error) {
      console.error('Check-in error:', error);
      return { error: error.message || 'Failed to process check-in' };
    }
    
    if (result?.error) {
      return { error: result.error };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'event_check_in',
      resource_id: result?.check_in_id,
      operation_status: 'success',
      new_values: {
        event_id: validatedData.event_id,
        customer_id: validatedData.customer_id,
        points_earned: result?.points_earned
      }
    });
    
    // Check for tier upgrade after check-in
    const { checkAndUpdateMemberTier } = await import('./loyalty-tiers');
    const tierResult = await checkAndUpdateMemberTier(result?.member_id);
    
    // Check for new achievements after check-in
    const { checkAchievementsAfterCheckIn } = await import('./loyalty-achievement-engine');
    const achievementResult = await checkAchievementsAfterCheckIn(result?.member_id || validatedData.customer_id, validatedData.event_id);
    
    // Send SMS notification if points were earned
    if (result?.points_earned && result.points_earned > 0) {
      const { sendLoyaltyNotificationInternal } = await import('./loyalty-notifications');
      
      // Send points earned notification
      await sendLoyaltyNotificationInternal({
        member_id: result.member_id || validatedData.customer_id,
        type: 'points_earned',
        data: {
          points: result.points_earned,
          new_balance: result.new_balance
        }
      });
      
      // Send tier upgrade notification if applicable
      if (tierResult.upgraded) {
        // Get the new tier details for the multiplier
        const { data: newTierData } = await adminSupabase
          .from('loyalty_tiers')
          .select('point_multiplier')
          .eq('name', tierResult.newTier)
          .single();
        
        await sendLoyaltyNotificationInternal({
          member_id: result.member_id || validatedData.customer_id,
          type: 'tier_upgrade',
          data: {
            old_tier: tierResult.oldTier,
            new_tier: tierResult.newTier,
            multiplier: newTierData?.point_multiplier || 1.0
          }
        });
      }
      
      // Send achievement notifications
      if (achievementResult && 'newAchievements' in achievementResult && achievementResult.newAchievements && achievementResult.newAchievements.length > 0) {
        for (const achievement of achievementResult.newAchievements) {
          await sendLoyaltyNotificationInternal({
            member_id: result.member_id || validatedData.customer_id,
            type: 'achievement',
            data: {
              achievement_name: achievement.name,
              achievement_description: achievement.description,
              points_earned: achievement.points_value
            }
          });
        }
      }
    }
    
    revalidatePath('/loyalty/checkin');
    revalidatePath(`/events/${validatedData.event_id}`);
    
    return { 
      success: true, 
      data: {
        check_in_id: result?.check_in_id,
        points_earned: result?.points_earned,
        new_balance: result?.new_balance,
        lifetime_events: result?.lifetime_events,
        member_id: result?.member_id || validatedData.customer_id,
        tierUpgraded: tierResult.upgraded || false,
        newTier: tierResult.newTier,
        oldTier: tierResult.oldTier,
        newAchievements: (achievementResult && 'newAchievements' in achievementResult) ? achievementResult.newAchievements : []
      }
    };
  } catch (error) {
    console.error('Server action error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Get check-ins for an event
export async function getEventCheckIns(eventId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('events', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view check-ins' };
    }
    
    const { data, error } = await supabase
      .from('event_check_ins')
      .select(`
        *,
        customer:customers(first_name, last_name, mobile_number),
        staff:users(email),
        member:loyalty_members(
          tier:loyalty_tiers(name, color, icon)
        )
      `)
      .eq('event_id', eventId)
      .order('check_in_time', { ascending: false });
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load check-ins' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading check-ins:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Validate QR code and get booking details
export async function validateQRCode(qrData: string) {
  try {
    const supabase = await createClient();
    
    // Decode and parse QR data
    let parsedData;
    try {
      const decoded = Buffer.from(qrData, 'base64').toString();
      parsedData = JSON.parse(decoded);
    } catch {
      return { error: 'Invalid QR code format' };
    }
    
    // Validate QR data structure
    if (!parsedData.type || parsedData.type !== 'loyalty_checkin') {
      return { error: 'Invalid QR code type' };
    }
    
    if (!parsedData.token || !parsedData.booking_id || !parsedData.event_id) {
      return { error: 'Invalid QR code data' };
    }
    
    // Check if QR code has expired
    if (new Date(parsedData.expires) < new Date()) {
      return { error: 'QR code has expired' };
    }
    
    // Validate token against booking
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(*),
        event:events(*)
      `)
      .eq('id', parsedData.booking_id)
      .eq('qr_token', parsedData.token)
      .single();
    
    if (error || !booking) {
      return { error: 'Invalid or expired QR code' };
    }
    
    // Check if already checked in
    const { data: existingCheckIn } = await supabase
      .from('event_check_ins')
      .select('id')
      .eq('event_id', parsedData.event_id)
      .eq('customer_id', booking.customer_id)
      .single();
    
    if (existingCheckIn) {
      return { error: 'Already checked in for this event' };
    }
    
    return { 
      data: {
        booking,
        event_id: parsedData.event_id,
        customer_id: booking.customer_id
      }
    };
  } catch (error) {
    console.error('Error validating QR code:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get check-in statistics for an event
export async function getEventCheckInStats(eventId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('events', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view statistics' };
    }
    
    // Get total check-ins
    const { count: totalCheckIns } = await supabase
      .from('event_check_ins')
      .select('id', { count: 'exact' })
      .eq('event_id', eventId);
    
    // Get check-ins by method
    const { data: checkInMethods } = await supabase
      .from('event_check_ins')
      .select('check_in_method')
      .eq('event_id', eventId);
    
    const methodCounts = checkInMethods?.reduce((acc, item) => {
      acc[item.check_in_method] = (acc[item.check_in_method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Get total points awarded
    const { data: pointsData } = await supabase
      .from('event_check_ins')
      .select('points_earned')
      .eq('event_id', eventId);
    
    const totalPoints = pointsData?.reduce((sum, item) => sum + (item.points_earned || 0), 0) || 0;
    
    return {
      data: {
        totalCheckIns: totalCheckIns || 0,
        checkInMethods: methodCounts,
        totalPointsAwarded: totalPoints,
        qrCheckIns: methodCounts.qr || 0,
        manualCheckIns: methodCounts.manual || 0,
        selfCheckIns: methodCounts.self || 0
      }
    };
  } catch (error) {
    console.error('Error loading check-in statistics:', error);
    return { error: 'An unexpected error occurred' };
  }
}