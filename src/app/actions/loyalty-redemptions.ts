'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

// Validation schemas
const CreateRedemptionSchema = z.object({
  member_id: z.string().uuid(),
  reward_id: z.string().uuid(),
  points_to_spend: z.number().positive()
});

// Generate redemption code
function generateRedemptionCode(): string {
  // Generate a code like ABC1234
  const letters = crypto.randomBytes(2).toString('hex').toUpperCase().substring(0, 3);
  const numbers = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return letters + numbers;
}

// Create a new redemption
export async function createRedemption(data: z.infer<typeof CreateRedemptionSchema>) {
  try {
    const supabase = await createClient();
    
    // Validate input
    const validatedData = CreateRedemptionSchema.parse(data);
    
    // Check member has enough points
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .select('available_points')
      .eq('id', validatedData.member_id)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    if (member.available_points < validatedData.points_to_spend) {
      return { error: 'Insufficient points' };
    }
    
    // Generate unique redemption code
    let code = generateRedemptionCode();
    let attempts = 0;
    
    // Ensure code is unique
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from('reward_redemptions')
        .select('id')
        .eq('code', code)
        .single();
      
      if (!existing) break;
      code = generateRedemptionCode();
      attempts++;
    }
    
    // Create redemption
    const { data: redemption, error: redemptionError } = await supabase
      .from('reward_redemptions')
      .insert({
        member_id: validatedData.member_id,
        reward_id: validatedData.reward_id,
        points_spent: validatedData.points_to_spend,
        code,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      })
      .select()
      .single();
    
    if (redemptionError) {
      console.error('Redemption error:', redemptionError);
      return { error: 'Failed to create redemption' };
    }
    
    // Deduct points
    const { error: pointsError } = await supabase
      .from('loyalty_members')
      .update({
        available_points: member.available_points - validatedData.points_to_spend
      })
      .eq('id', validatedData.member_id);
    
    if (pointsError) {
      // Rollback redemption
      await supabase
        .from('reward_redemptions')
        .delete()
        .eq('id', redemption.id);
      
      return { error: 'Failed to deduct points' };
    }
    
    // Record point transaction
    await supabase
      .from('loyalty_point_transactions')
      .insert({
        member_id: validatedData.member_id,
        points: -validatedData.points_to_spend,
        balance_after: member.available_points - validatedData.points_to_spend,
        transaction_type: 'redeemed',
        description: 'Reward redemption',
        reference_type: 'redemption',
        reference_id: redemption.id
      });
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'reward_redemption',
      resource_id: redemption.id,
      operation_status: 'success',
      new_values: {
        reward_id: validatedData.reward_id,
        points_spent: validatedData.points_to_spend
      }
    });
    
    revalidatePath('/loyalty');
    
    return { 
      success: true, 
      data: {
        redemption_id: redemption.id,
        code: redemption.code,
        expires_at: redemption.expires_at
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

// Validate redemption code
export async function validateRedemptionCode(code: string) {
  try {
    const supabase = await createClient();
    
    // Find redemption by code
    const { data: redemption, error } = await supabase
      .from('reward_redemptions')
      .select(`
        *,
        member:loyalty_members(
          customer:customers(name)
        ),
        reward:loyalty_rewards(name, description)
      `)
      .eq('code', code.toUpperCase())
      .single();
    
    if (error || !redemption) {
      return { error: 'Invalid redemption code' };
    }
    
    // Check if already used
    if (redemption.status === 'fulfilled') {
      return { error: 'This code has already been used' };
    }
    
    // Check if expired
    if (redemption.expires_at && new Date(redemption.expires_at) < new Date()) {
      return { error: 'This code has expired' };
    }
    
    // Check if cancelled
    if (redemption.status === 'cancelled') {
      return { error: 'This redemption has been cancelled' };
    }
    
    return { 
      data: {
        redemption_id: redemption.id,
        member_id: redemption.member_id,
        reward_id: redemption.reward_id,
        points_spent: redemption.points_spent,
        member_name: redemption.member?.customer?.name,
        reward_name: redemption.reward?.name,
        reward_description: redemption.reward?.description
      }
    };
  } catch (error) {
    console.error('Validation error:', error);
    return { error: 'Failed to validate code' };
  }
}

// Process redemption (mark as fulfilled)
export async function processRedemption(redemptionId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to process redemptions' };
    }
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    // Get redemption details
    const { data: redemption, error: fetchError } = await supabase
      .from('reward_redemptions')
      .select(`
        *,
        member:loyalty_members(
          customer:customers(name),
          tier:loyalty_tiers(name)
        ),
        reward:loyalty_rewards(name, description)
      `)
      .eq('id', redemptionId)
      .single();
    
    if (fetchError || !redemption) {
      return { error: 'Redemption not found' };
    }
    
    if (redemption.status === 'fulfilled') {
      return { error: 'Already redeemed' };
    }
    
    // Update redemption status
    const { error: updateError } = await supabase
      .from('reward_redemptions')
      .update({
        status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
        fulfilled_by: user?.id
      })
      .eq('id', redemptionId);
    
    if (updateError) {
      console.error('Update error:', updateError);
      return { error: 'Failed to process redemption' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'reward_redemption',
      resource_id: redemptionId,
      operation_status: 'success',
      new_values: { status: 'fulfilled' }
    });
    
    revalidatePath('/loyalty/redeem');
    
    return { 
      success: true,
      data: {
        redemption_id: redemption.id,
        reward_name: redemption.reward?.name,
        reward_description: redemption.reward?.description,
        member_name: redemption.member?.customer?.name,
        member_tier: redemption.member?.tier?.name,
        points_spent: redemption.points_spent
      }
    };
  } catch (error) {
    console.error('Processing error:', error);
    return { error: 'Failed to process redemption' };
  }
}

// Get pending redemptions
export async function getPendingRedemptions() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view redemptions' };
    }
    
    const { data, error } = await supabase
      .from('reward_redemptions')
      .select(`
        *,
        member:loyalty_members(
          customer:customers(name, phone_number)
        ),
        reward:loyalty_rewards(name, points_cost)
      `)
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load redemptions' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading redemptions:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get member's redemption history
export async function getMemberRedemptions(memberId: string) {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('reward_redemptions')
      .select(`
        *,
        reward:loyalty_rewards(name, description, points_cost)
      `)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load redemption history' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading redemptions:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Cancel redemption
export async function cancelRedemption(redemptionId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to cancel redemptions' };
    }
    
    // Get redemption details
    const { data: redemption, error: fetchError } = await supabase
      .from('reward_redemptions')
      .select('*, member_id, points_spent, status')
      .eq('id', redemptionId)
      .single();
    
    if (fetchError || !redemption) {
      return { error: 'Redemption not found' };
    }
    
    if (redemption.status !== 'pending') {
      return { error: 'Can only cancel pending redemptions' };
    }
    
    // Update status
    const { error: updateError } = await supabase
      .from('reward_redemptions')
      .update({ status: 'cancelled' })
      .eq('id', redemptionId);
    
    if (updateError) {
      return { error: 'Failed to cancel redemption' };
    }
    
    // Refund points
    const { data: member } = await supabase
      .from('loyalty_members')
      .select('available_points')
      .eq('id', redemption.member_id)
      .single();
    
    if (member) {
      await supabase
        .from('loyalty_members')
        .update({
          available_points: member.available_points + redemption.points_spent
        })
        .eq('id', redemption.member_id);
      
      // Record refund transaction
      await supabase
        .from('loyalty_point_transactions')
        .insert({
          member_id: redemption.member_id,
          points: redemption.points_spent,
          balance_after: member.available_points + redemption.points_spent,
          transaction_type: 'adjusted',
          description: 'Redemption cancelled - points refunded',
          reference_type: 'redemption',
          reference_id: redemptionId
        });
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'reward_redemption',
      resource_id: redemptionId,
      operation_status: 'success',
      new_values: { status: 'cancelled' }
    });
    
    revalidatePath('/loyalty/redeem');
    
    return { success: true };
  } catch (error) {
    console.error('Cancel error:', error);
    return { error: 'Failed to cancel redemption' };
  }
}