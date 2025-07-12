'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { LoyaltyAchievement, AchievementFormData } from '@/types/loyalty';

// Validation schemas
const CreateAchievementSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  category: z.string().min(1, 'Category is required'),
  points_value: z.number().min(0, 'Points value must be non-negative'),
  criteria: z.record(z.any()),
  icon: z.string().optional(),
  sort_order: z.number().optional(),
  active: z.boolean()
});

const UpdateAchievementSchema = CreateAchievementSchema.extend({
  id: z.string()
});

/**
 * Get all achievements
 */
export async function getAchievements(filters?: {
  active?: boolean;
  category?: string;
  program_id?: string;
}) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view achievements' };
    }

    let query = supabase
      .from('loyalty_achievements')
      .select('*')
      .order('category')
      .order('sort_order')
      .order('name');

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
      console.error('Error fetching achievements:', error);
      return { error: 'Failed to fetch achievements' };
    }

    return { data };
  } catch (error) {
    console.error('Error in getAchievements:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get single achievement by ID
 */
export async function getAchievement(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view achievements' };
    }

    const { data, error } = await supabase
      .from('loyalty_achievements')
      .select(`
        *,
        customer_achievements(count)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching achievement:', error);
      return { error: 'Failed to fetch achievement' };
    }

    // Get unlock count
    const { count: unlockCount } = await supabase
      .from('customer_achievements')
      .select('*', { count: 'exact', head: true })
      .eq('achievement_id', id);

    return { 
      data: {
        ...data,
        unlock_count: unlockCount || 0
      }
    };
  } catch (error) {
    console.error('Error in getAchievement:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Create a new achievement
 */
export async function createAchievement(formData: AchievementFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to create achievements' };
    }

    // Validate input
    const validatedData = CreateAchievementSchema.parse(formData);

    // Get default program ID
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();

    if (!program) {
      return { error: 'No active loyalty program found' };
    }

    // Create achievement
    const { data, error } = await supabase
      .from('loyalty_achievements')
      .insert({
        program_id: program.id,
        ...validatedData
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating achievement:', error);
      return { error: 'Failed to create achievement' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_achievement',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { name: data.name, points_value: data.points_value }
    });

    revalidatePath('/loyalty/admin/achievements');
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in createAchievement:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Update an existing achievement
 */
export async function updateAchievement(id: string, formData: AchievementFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update achievements' };
    }

    // Validate input
    const validatedData = UpdateAchievementSchema.parse({ id, ...formData });

    // Update achievement
    const { data, error } = await supabase
      .from('loyalty_achievements')
      .update({
        name: validatedData.name,
        description: validatedData.description,
        category: validatedData.category,
        points_value: validatedData.points_value,
        criteria: validatedData.criteria,
        icon: validatedData.icon,
        sort_order: validatedData.sort_order,
        active: validatedData.active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating achievement:', error);
      return { error: 'Failed to update achievement' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_achievement',
      resource_id: data.id,
      operation_status: 'success',
      new_values: formData
    });

    revalidatePath('/loyalty/admin/achievements');
    revalidatePath(`/loyalty/admin/achievements/${id}`);
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in updateAchievement:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Delete an achievement
 */
export async function deleteAchievement(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to delete achievements' };
    }

    // Check if achievement has been earned
    const { data: earned } = await supabase
      .from('customer_achievements')
      .select('id')
      .eq('achievement_id', id)
      .limit(1);

    if (earned && earned.length > 0) {
      return { error: 'Cannot delete achievement that has been earned. Deactivate it instead.' };
    }

    // Get achievement details for audit log
    const { data: achievement } = await supabase
      .from('loyalty_achievements')
      .select('name')
      .eq('id', id)
      .single();

    // Delete achievement
    const { error } = await supabase
      .from('loyalty_achievements')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting achievement:', error);
      return { error: 'Failed to delete achievement' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'loyalty_achievement',
      resource_id: id,
      operation_status: 'success',
      old_values: { name: achievement?.name }
    });

    revalidatePath('/loyalty/admin/achievements');
    
    return { success: true };
  } catch (error) {
    console.error('Error in deleteAchievement:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get achievement statistics
 */
export async function getAchievementStats() {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view statistics' };
    }

    // Get total achievements
    const { count: totalAchievements } = await supabase
      .from('loyalty_achievements')
      .select('*', { count: 'exact', head: true });

    // Get active achievements
    const { count: activeAchievements } = await supabase
      .from('loyalty_achievements')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);

    // Get total unlocks
    const { count: totalUnlocks } = await supabase
      .from('customer_achievements')
      .select('*', { count: 'exact', head: true });

    // Get unique members with achievements
    const { data: uniqueMembers } = await supabase
      .from('customer_achievements')
      .select('member_id')
      .limit(1000);

    const uniqueMemberCount = new Set(uniqueMembers?.map(u => u.member_id) || []).size;

    // Get categories
    const { data: categories } = await supabase
      .from('loyalty_achievements')
      .select('category')
      .order('category');

    const uniqueCategories = [...new Set(categories?.map(c => c.category) || [])];

    return {
      data: {
        totalAchievements: totalAchievements || 0,
        activeAchievements: activeAchievements || 0,
        totalUnlocks: totalUnlocks || 0,
        membersWithAchievements: uniqueMemberCount,
        categories: uniqueCategories
      }
    };
  } catch (error) {
    console.error('Error in getAchievementStats:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get achievement categories
 */
export async function getAchievementCategories() {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view categories' };
    }

    const { data, error } = await supabase
      .from('loyalty_achievements')
      .select('category')
      .order('category');

    if (error) {
      console.error('Error fetching categories:', error);
      return { error: 'Failed to fetch categories' };
    }

    // Get unique categories with counts
    const categoryCounts = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return { 
      data: Object.entries(categoryCounts).map(([name, count]) => ({ name, count }))
    };
  } catch (error) {
    console.error('Error in getAchievementCategories:', error);
    return { error: 'An unexpected error occurred' };
  }
}