'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { LoyaltyService } from '@/lib/services/loyalty';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { createClient } from '@/lib/supabase/server';

// Validation schemas
const CheckInSchema = z.object({
  phoneNumber: z.string().min(10, 'Invalid phone number'),
  eventId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional()
});

const GenerateRedemptionSchema = z.object({
  memberId: z.string(),
  rewardId: z.string()
});

const RedeemCodeSchema = z.object({
  code: z.string().length(7, 'Invalid code format')
});

const EnrollMemberSchema = z.object({
  customerId: z.string(),
  phoneNumber: z.string()
});

/**
 * Customer self check-in
 */
export async function customerCheckIn(formData: FormData) {
  try {
    const validatedData = CheckInSchema.parse({
      phoneNumber: formData.get('phoneNumber'),
      eventId: formData.get('eventId'),
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName')
    });
    
    // Check if this is a new member enrollment with name
    if (validatedData.firstName && validatedData.lastName) {
      const fullName = `${validatedData.firstName.trim()} ${validatedData.lastName.trim()}`;
      const member = await LoyaltyService.enrollMember(validatedData.phoneNumber, fullName);
      
      // Auto check-in after enrollment
      const result = await LoyaltyService.checkIn(
        validatedData.phoneNumber,
        validatedData.eventId || 'event-123'
      );
      
      return { 
        success: true, 
        data: { ...result, isNewMember: true } 
      };
    }
    
    // For customer self-service, no permission check needed
    const result = await LoyaltyService.checkIn(
      validatedData.phoneNumber,
      validatedData.eventId || 'event-123' // Default to today's event
    );
    
    if (!result.success) {
      return { error: result.error };
    }
    
    // In production: Log to database
    if (result.member) {
      // await logAuditEvent(supabase, {
      //   action: 'loyalty_checkin',
      //   entity_type: 'loyalty_member',
      //   entity_id: result.member.id,
      //   details: { 
      //     points_earned: result.pointsEarned,
      //     event_id: validatedData.eventId 
      //   }
      // });
    }
    
    revalidatePath('/loyalty');
    
    return { 
      success: true, 
      data: result 
    };
  } catch (error) {
    console.error('Check-in error:', error);
    return { error: 'Failed to process check-in' };
  }
}

/**
 * Staff-initiated check-in
 */
export async function staffCheckIn(formData: FormData) {
  try {
    // Check staff permissions
    const hasPermission = await checkUserPermission('events', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to check in customers' };
    }
    
    const validatedData = CheckInSchema.parse({
      phoneNumber: formData.get('phoneNumber'),
      eventId: formData.get('eventId')
    });
    
    const result = await LoyaltyService.checkIn(
      validatedData.phoneNumber,
      validatedData.eventId || 'event-123'
    );
    
    if (!result.success) {
      return { error: result.error };
    }
    
    // In production: Log to database
    const supabase = await createClient();
    if (result.member) {
      // await logAuditEvent(supabase, {
      //   action: 'staff_loyalty_checkin',
      //   entity_type: 'loyalty_member',
      //   entity_id: result.member.id,
      //   details: { 
      //     points_earned: result.pointsEarned,
      //     event_id: validatedData.eventId 
      //   }
      // });
    }
    
    revalidatePath('/loyalty');
    revalidatePath('/events');
    
    return { 
      success: true, 
      data: result 
    };
  } catch (error) {
    console.error('Staff check-in error:', error);
    return { error: 'Failed to process check-in' };
  }
}

/**
 * Generate redemption code
 */
export async function generateRedemptionCode(formData: FormData) {
  try {
    const validatedData = GenerateRedemptionSchema.parse({
      memberId: formData.get('memberId'),
      rewardId: formData.get('rewardId')
    });
    
    const code = await LoyaltyService.generateRedemption(
      validatedData.memberId,
      validatedData.rewardId
    );
    
    if (!code) {
      return { error: 'Failed to generate redemption code' };
    }
    
    // In production: Log to database
    // await logAuditEvent(supabase, {
    //   action: 'generate_redemption',
    //   entity_type: 'loyalty_redemption',
    //   entity_id: code.code,
    //   details: { 
    //     member_id: validatedData.memberId,
    //     reward_id: validatedData.rewardId
    //   }
    // });
    
    return { 
      success: true, 
      data: code 
    };
  } catch (error) {
    console.error('Generate redemption error:', error);
    return { error: 'Failed to generate redemption code' };
  }
}

/**
 * Redeem a code (staff)
 */
export async function redeemCode(formData: FormData) {
  try {
    // Check staff permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to redeem codes' };
    }
    
    const validatedData = RedeemCodeSchema.parse({
      code: formData.get('code')
    });
    
    const result = await LoyaltyService.redeemCode(validatedData.code);
    
    if (!result.success) {
      return { error: result.error };
    }
    
    // In production: Log to database
    const supabase = await createClient();
    if (result.member && result.reward) {
      // await logAuditEvent(supabase, {
      //   action: 'redeem_reward',
      //   entity_type: 'loyalty_redemption',
      //   entity_id: validatedData.code,
      //   details: { 
      //     member_id: result.member.id,
      //     reward_id: result.reward.id,
      //     reward_name: result.reward.name
      //   }
      // });
    }
    
    revalidatePath('/loyalty');
    
    return { 
      success: true, 
      data: result 
    };
  } catch (error) {
    console.error('Redeem code error:', error);
    return { error: 'Failed to redeem code' };
  }
}

/**
 * Get member details
 */
export async function getMemberDetails(phoneNumber: string) {
  try {
    const member = await LoyaltyService.getMemberByPhone(phoneNumber);
    
    if (!member) {
      return { error: 'Member not found' };
    }
    
    const stats = await LoyaltyService.getMemberStats(member.id);
    
    return { 
      success: true, 
      data: stats 
    };
  } catch (error) {
    console.error('Get member error:', error);
    return { error: 'Failed to get member details' };
  }
}

/**
 * Enroll existing customer in loyalty program
 */
export async function enrollCustomer(formData: FormData) {
  try {
    // Check staff permissions
    const hasPermission = await checkUserPermission('customers', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to enroll customers' };
    }
    
    const validatedData = EnrollMemberSchema.parse({
      customerId: formData.get('customerId'),
      phoneNumber: formData.get('phoneNumber')
    });
    
    // Check if already enrolled
    const existing = await LoyaltyService.getMemberByPhone(validatedData.phoneNumber);
    if (existing) {
      return { error: 'Customer already enrolled in loyalty program' };
    }
    
    const member = await LoyaltyService.enrollMember(validatedData.phoneNumber);
    
    // In production: Log to database
    const supabase = await createClient();
    // await logAuditEvent(supabase, {
    //   action: 'enroll_loyalty_member',
    //   entity_type: 'loyalty_member',
    //   entity_id: member.id,
    //   details: { 
    //     customer_id: validatedData.customerId,
    //     phone_number: validatedData.phoneNumber
    //   }
    // });
    
    revalidatePath('/loyalty');
    revalidatePath('/customers');
    
    return { 
      success: true, 
      data: member 
    };
  } catch (error) {
    console.error('Enroll customer error:', error);
    return { error: 'Failed to enroll customer' };
  }
}

/**
 * Get loyalty program statistics (admin)
 */
export async function getLoyaltyStats() {
  try {
    // Check admin permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty statistics' };
    }
    
    // In production: Query from database
    // For now, calculate from mock data
    const { mockMembers, activeRedemptionCodes } = await import('@/lib/mock-data/loyalty-demo');
    
    const stats = {
      totalMembers: Object.keys(mockMembers).length,
      membersByTier: {
        member: 0,
        bronze: 0,
        silver: 0,
        gold: 0,
        platinum: 0
      },
      activeRedemptions: activeRedemptionCodes.filter(c => !c.used).length,
      totalPointsIssued: Object.values(mockMembers).reduce((sum, m) => sum + m.totalPoints, 0),
      totalPointsRedeemed: Object.values(mockMembers).reduce((sum, m) => sum + (m.totalPoints - m.availablePoints), 0)
    };
    
    // Count by tier
    Object.values(mockMembers).forEach(member => {
      stats.membersByTier[member.tier]++;
    });
    
    return { 
      success: true, 
      data: stats 
    };
  } catch (error) {
    console.error('Get loyalty stats error:', error);
    return { error: 'Failed to get loyalty statistics' };
  }
}