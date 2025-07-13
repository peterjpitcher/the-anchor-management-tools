'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
// Removed mock LoyaltyService - using database directly
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { createClient } from '@/lib/supabase/server';
import { enrollLoyaltyMember } from './loyalty-members';

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
    const supabase = await createClient();
    
    const validatedData = CheckInSchema.parse({
      phoneNumber: formData.get('phoneNumber'),
      eventId: formData.get('eventId'),
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName')
    });
    
    // Normalize phone number to E.164 format
    let phoneNumber = validatedData.phoneNumber.replace(/\s/g, '');
    if (phoneNumber.startsWith('0')) {
      phoneNumber = '+44' + phoneNumber.substring(1);
    } else if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+44' + phoneNumber;
    }
    
    // Get or create customer
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name')
      .eq('phone_number', phoneNumber)
      .single();
    
    if (!customer) {
      // If customer doesn't exist and we have name, create them
      if (validatedData.firstName && validatedData.lastName) {
        const fullName = `${validatedData.firstName.trim()} ${validatedData.lastName.trim()}`;
        
        const { data: newCustomer, error: createError } = await supabase
          .from('customers')
          .insert({
            name: fullName,
            phone_number: phoneNumber
          })
          .select()
          .single();
          
        if (createError || !newCustomer) {
          return { error: 'Failed to create customer record' };
        }
        
        // Create loyalty member
        const { data: program } = await supabase
          .from('loyalty_programs')
          .select('id')
          .eq('active', true)
          .single();
          
        if (program) {
          await supabase
            .from('loyalty_members')
            .insert({
              customer_id: newCustomer.id,
              program_id: program.id,
              status: 'active'
            });
        }
        
        return { 
          success: true, 
          data: { 
            success: true,
            isNewMember: true,
            message: 'Welcome to The Anchor VIP Club!' 
          } 
        };
      }
      
      return { error: 'Customer not found. Please provide your name to enroll.' };
    }
    
    // Check if customer is a loyalty member
    const { data: member } = await supabase
      .from('loyalty_members')
      .select('*')
      .eq('customer_id', customer.id)
      .eq('status', 'active')
      .single();
    
    if (!member) {
      return { error: 'Not enrolled in VIP Club. Please ask staff to enroll you.' };
    }
    
    // Process check-in (this would call the database function)
    const eventId = validatedData.eventId || '';
    if (!eventId) {
      return { error: 'No event ID provided' };
    }
    
    revalidatePath('/loyalty');
    
    return { 
      success: true, 
      data: {
        success: true,
        member: {
          id: member.id,
          name: customer.name,
          tier: 'member' // Would need to fetch from tier table
        },
        message: 'Check-in successful!'
      } 
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
    
    // This would integrate with the loyalty-checkins.ts processEventCheckIn
    // For now, return a placeholder response
    const supabase = await createClient();
    
    revalidatePath('/loyalty');
    revalidatePath('/events');
    
    return { 
      success: true, 
      data: {
        success: true,
        message: 'Check-in functionality will be available when loyalty system is enabled'
      }
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
    
    // This would integrate with loyalty-redemptions.ts
    // For now, return a placeholder
    const code = null;
    
    if (!code) {
      return { error: 'Redemption functionality will be available when loyalty system is enabled' };
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
    
    // This would integrate with loyalty-redemptions.ts
    // For now, return a placeholder
    return { error: 'Redemption functionality will be available when loyalty system is enabled' };
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
    // This would integrate with loyalty-members.ts
    // For now, return a placeholder
    return { error: 'Member lookup will be available when loyalty system is enabled' };
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
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to enroll customers' };
    }
    
    const validatedData = EnrollMemberSchema.parse({
      customerId: formData.get('customerId'),
      phoneNumber: formData.get('phoneNumber')
    });
    
    // Use the actual enrollment function from loyalty-members.ts
    const result = await enrollLoyaltyMember({
      customer_id: validatedData.customerId,
      status: 'active'
    });
    
    return result;
  } catch (error) {
    console.error('Enroll customer error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to enroll customer' };
  }
}

/**
 * Get loyalty program statistics (admin)
 */
export async function getLoyaltyStats() {
  try {
    const supabase = await createClient();
    
    // Check admin permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty statistics' };
    }
    
    // Get active program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();
    
    if (!program) {
      return { error: 'No active loyalty program found' };
    }
    
    // Get total members count
    const { count: totalMembers } = await supabase
      .from('loyalty_members')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .eq('status', 'active');
    
    // Get members by tier
    const { data: tierCounts } = await supabase
      .from('loyalty_members')
      .select(`
        id,
        tier:loyalty_tiers!inner(name)
      `)
      .eq('program_id', program.id)
      .eq('status', 'active');
    
    const membersByTier = {
      member: 0,
      bronze: 0,
      silver: 0,
      gold: 0,
      platinum: 0
    };
    
    tierCounts?.forEach((member: any) => {
      const tierName = member.tier?.name?.toLowerCase() || 'member';
      if (tierName in membersByTier) {
        membersByTier[tierName as keyof typeof membersByTier]++;
      }
    });
    
    // Get active redemptions count
    const { count: activeRedemptions } = await supabase
      .from('reward_redemptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString());
    
    // Get total points issued
    const { data: pointsIssued } = await supabase
      .from('loyalty_point_transactions')
      .select('points')
      .gt('points', 0);
    
    const totalPointsIssued = pointsIssued?.reduce((sum, t) => sum + t.points, 0) || 0;
    
    // Get total points redeemed
    const { data: pointsRedeemed } = await supabase
      .from('loyalty_point_transactions')
      .select('points')
      .lt('points', 0);
    
    const totalPointsRedeemed = Math.abs(pointsRedeemed?.reduce((sum, t) => sum + t.points, 0) || 0);
    
    const stats = {
      totalMembers: totalMembers || 0,
      membersByTier,
      activeRedemptions: activeRedemptions || 0,
      totalPointsIssued,
      totalPointsRedeemed
    };
    
    return { 
      success: true, 
      data: stats 
    };
  } catch (error) {
    console.error('Get loyalty stats error:', error);
    return { error: 'Failed to get loyalty statistics' };
  }
}