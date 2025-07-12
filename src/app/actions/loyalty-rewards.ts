'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { LoyaltyReward, RewardFormData } from '@/types/loyalty';

// Validation schemas
const CreateRewardSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  points_cost: z.number().min(1, 'Points cost must be at least 1'),
  tier_required: z.string().optional(),
  icon: z.string().optional(),
  inventory: z.number().optional(),
  daily_limit: z.number().optional(),
  active: z.boolean()
});

const UpdateRewardSchema = CreateRewardSchema.extend({
  id: z.string()
});

/**
 * Get all rewards
 */
export async function getRewards(filters?: {
  active?: boolean;
  category?: string;
  program_id?: string;
}) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view rewards' };
    }

    let query = supabase
      .from('loyalty_rewards')
      .select(`
        *,
        tier:loyalty_tiers(id, name, color, icon)
      `)
      .order('category')
      .order('points_cost');

    // Apply filters
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active);
    }
    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.program_id) {
      query = query.eq('program_id', filters.program_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching rewards:', error);
      return { error: 'Failed to fetch rewards' };
    }

    return { data };
  } catch (error) {
    console.error('Error in getRewards:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get single reward by ID
 */
export async function getReward(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view rewards' };
    }

    const { data, error } = await supabase
      .from('loyalty_rewards')
      .select(`
        *,
        tier:loyalty_tiers(id, name, color, icon),
        redemptions:reward_redemptions(count)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching reward:', error);
      return { error: 'Failed to fetch reward' };
    }

    return { data };
  } catch (error) {
    console.error('Error in getReward:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Create a new reward
 */
export async function createReward(formData: RewardFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to create rewards' };
    }

    // Validate input
    const validatedData = CreateRewardSchema.parse(formData);

    // Get default program ID
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();

    if (!program) {
      return { error: 'No active loyalty program found' };
    }

    // Create reward
    const { data, error } = await supabase
      .from('loyalty_rewards')
      .insert({
        program_id: program.id,
        ...validatedData,
        metadata: {}
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating reward:', error);
      return { error: 'Failed to create reward' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_reward',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { name: data.name, points_cost: data.points_cost }
    });

    revalidatePath('/loyalty/admin/rewards');
    revalidatePath('/loyalty/rewards');
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in createReward:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Update an existing reward
 */
export async function updateReward(id: string, formData: RewardFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update rewards' };
    }

    // Validate input
    const validatedData = UpdateRewardSchema.parse({ id, ...formData });

    // Update reward
    const { data, error } = await supabase
      .from('loyalty_rewards')
      .update({
        name: validatedData.name,
        description: validatedData.description,
        category: validatedData.category,
        points_cost: validatedData.points_cost,
        tier_required: validatedData.tier_required,
        icon: validatedData.icon,
        inventory: validatedData.inventory,
        daily_limit: validatedData.daily_limit,
        active: validatedData.active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating reward:', error);
      return { error: 'Failed to update reward' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_reward',
      resource_id: data.id,
      operation_status: 'success',
      new_values: formData
    });

    revalidatePath('/loyalty/admin/rewards');
    revalidatePath(`/loyalty/admin/rewards/${id}`);
    revalidatePath('/loyalty/rewards');
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in updateReward:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Delete a reward
 */
export async function deleteReward(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to delete rewards' };
    }

    // Check if reward has been redeemed
    const { data: redemptions } = await supabase
      .from('reward_redemptions')
      .select('id')
      .eq('reward_id', id)
      .limit(1);

    if (redemptions && redemptions.length > 0) {
      return { error: 'Cannot delete reward that has been redeemed. Deactivate it instead.' };
    }

    // Get reward details for audit log
    const { data: reward } = await supabase
      .from('loyalty_rewards')
      .select('name')
      .eq('id', id)
      .single();

    // Delete reward
    const { error } = await supabase
      .from('loyalty_rewards')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting reward:', error);
      return { error: 'Failed to delete reward' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'loyalty_reward',
      resource_id: id,
      operation_status: 'success',
      old_values: { name: reward?.name }
    });

    revalidatePath('/loyalty/admin/rewards');
    revalidatePath('/loyalty/rewards');
    
    return { success: true };
  } catch (error) {
    console.error('Error in deleteReward:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Update reward inventory
 */
export async function updateRewardInventory(id: string, inventory: number) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update inventory' };
    }

    const { data, error } = await supabase
      .from('loyalty_rewards')
      .update({ inventory })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating inventory:', error);
      return { error: 'Failed to update inventory' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_reward_inventory',
      resource_id: id,
      operation_status: 'success',
      new_values: { inventory }
    });

    revalidatePath('/loyalty/admin/rewards');
    
    return { data, success: true };
  } catch (error) {
    console.error('Error in updateRewardInventory:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get reward statistics
 */
export async function getRewardStats() {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view statistics' };
    }

    // Get total rewards
    const { count: totalRewards } = await supabase
      .from('loyalty_rewards')
      .select('*', { count: 'exact', head: true });

    // Get active rewards
    const { count: activeRewards } = await supabase
      .from('loyalty_rewards')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);

    // Get low stock rewards
    const { data: lowStock } = await supabase
      .from('loyalty_rewards')
      .select('id')
      .not('inventory', 'is', null)
      .lt('inventory', 10);

    // Get total redemptions
    const { count: totalRedemptions } = await supabase
      .from('reward_redemptions')
      .select('*', { count: 'exact', head: true });

    return {
      data: {
        totalRewards: totalRewards || 0,
        activeRewards: activeRewards || 0,
        lowStockCount: lowStock?.length || 0,
        totalRedemptions: totalRedemptions || 0
      }
    };
  } catch (error) {
    console.error('Error in getRewardStats:', error);
    return { error: 'An unexpected error occurred' };
  }
}