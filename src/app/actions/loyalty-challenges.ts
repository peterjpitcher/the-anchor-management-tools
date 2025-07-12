'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { LoyaltyChallenge, ChallengeFormData } from '@/types/loyalty';

// Validation schemas
const CreateChallengeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  category: z.enum(['monthly', 'seasonal', 'special']),
  points_value: z.number().min(0, 'Points value must be non-negative'),
  criteria: z.record(z.any()),
  start_date: z.string(),
  end_date: z.string(),
  max_completions: z.number().min(1).optional(),
  icon: z.string().optional(),
  sort_order: z.number().optional(),
  active: z.boolean()
});

const UpdateChallengeSchema = CreateChallengeSchema.extend({
  id: z.string()
});

/**
 * Get all challenges
 */
export async function getChallenges(filters?: {
  active?: boolean;
  category?: string;
  current?: boolean;
  program_id?: string;
}) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view challenges' };
    }

    let query = supabase
      .from('loyalty_challenges')
      .select('*')
      .order('start_date', { ascending: false })
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
    
    // Filter for current challenges
    if (filters?.current) {
      const now = new Date().toISOString();
      query = query
        .lte('start_date', now)
        .gte('end_date', now)
        .eq('active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching challenges:', error);
      return { error: 'Failed to fetch challenges' };
    }

    return { data };
  } catch (error) {
    console.error('Error in getChallenges:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get single challenge by ID
 */
export async function getChallenge(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view challenges' };
    }

    const { data, error } = await supabase
      .from('loyalty_challenges')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching challenge:', error);
      return { error: 'Failed to fetch challenge' };
    }

    // Get participation count
    const { count: participantCount } = await supabase
      .from('customer_challenges')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', id);

    // Get completion count
    const { count: completionCount } = await supabase
      .from('customer_challenges')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', id)
      .gt('completed_count', 0);

    return { 
      data: {
        ...data,
        participant_count: participantCount || 0,
        completion_count: completionCount || 0
      }
    };
  } catch (error) {
    console.error('Error in getChallenge:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Create a new challenge
 */
export async function createChallenge(formData: ChallengeFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to create challenges' };
    }

    // Validate input
    const validatedData = CreateChallengeSchema.parse(formData);

    // Validate date range
    const startDate = new Date(validatedData.start_date);
    const endDate = new Date(validatedData.end_date);
    
    if (endDate <= startDate) {
      return { error: 'End date must be after start date' };
    }

    // Get default program ID
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('active', true)
      .single();

    if (!program) {
      return { error: 'No active loyalty program found' };
    }

    // Create challenge
    const { data, error } = await supabase
      .from('loyalty_challenges')
      .insert({
        program_id: program.id,
        ...validatedData,
        max_completions: validatedData.max_completions || 1
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating challenge:', error);
      return { error: 'Failed to create challenge' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_challenge',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { 
        name: data.name, 
        points_value: data.points_value,
        date_range: `${data.start_date} to ${data.end_date}`
      }
    });

    revalidatePath('/loyalty/admin/challenges');
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in createChallenge:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Update an existing challenge
 */
export async function updateChallenge(id: string, formData: ChallengeFormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update challenges' };
    }

    // Validate input
    const validatedData = UpdateChallengeSchema.parse({ id, ...formData });

    // Validate date range
    const startDate = new Date(validatedData.start_date);
    const endDate = new Date(validatedData.end_date);
    
    if (endDate <= startDate) {
      return { error: 'End date must be after start date' };
    }

    // Update challenge
    const { data, error } = await supabase
      .from('loyalty_challenges')
      .update({
        name: validatedData.name,
        description: validatedData.description,
        category: validatedData.category,
        points_value: validatedData.points_value,
        criteria: validatedData.criteria,
        start_date: validatedData.start_date,
        end_date: validatedData.end_date,
        max_completions: validatedData.max_completions || 1,
        icon: validatedData.icon,
        sort_order: validatedData.sort_order,
        active: validatedData.active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating challenge:', error);
      return { error: 'Failed to update challenge' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_challenge',
      resource_id: data.id,
      operation_status: 'success',
      new_values: formData
    });

    revalidatePath('/loyalty/admin/challenges');
    revalidatePath(`/loyalty/admin/challenges/${id}`);
    
    return { data, success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    console.error('Error in updateChallenge:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Delete a challenge
 */
export async function deleteChallenge(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to delete challenges' };
    }

    // Check if challenge has participants
    const { data: participants } = await supabase
      .from('customer_challenges')
      .select('id')
      .eq('challenge_id', id)
      .limit(1);

    if (participants && participants.length > 0) {
      return { error: 'Cannot delete challenge that has participants. Deactivate it instead.' };
    }

    // Get challenge details for audit log
    const { data: challenge } = await supabase
      .from('loyalty_challenges')
      .select('name')
      .eq('id', id)
      .single();

    // Delete challenge
    const { error } = await supabase
      .from('loyalty_challenges')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting challenge:', error);
      return { error: 'Failed to delete challenge' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'loyalty_challenge',
      resource_id: id,
      operation_status: 'success',
      old_values: { name: challenge?.name }
    });

    revalidatePath('/loyalty/admin/challenges');
    
    return { success: true };
  } catch (error) {
    console.error('Error in deleteChallenge:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get challenge statistics
 */
export async function getChallengeStats() {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view statistics' };
    }

    const now = new Date().toISOString();

    // Get total challenges
    const { count: totalChallenges } = await supabase
      .from('loyalty_challenges')
      .select('*', { count: 'exact', head: true });

    // Get active challenges
    const { count: activeChallenges } = await supabase
      .from('loyalty_challenges')
      .select('*', { count: 'exact', head: true })
      .eq('active', true)
      .lte('start_date', now)
      .gte('end_date', now);

    // Get upcoming challenges
    const { count: upcomingChallenges } = await supabase
      .from('loyalty_challenges')
      .select('*', { count: 'exact', head: true })
      .eq('active', true)
      .gt('start_date', now);

    // Get total participants
    const { count: totalParticipants } = await supabase
      .from('customer_challenges')
      .select('*', { count: 'exact', head: true });

    // Get total completions
    const { data: completions } = await supabase
      .from('customer_challenges')
      .select('completed_count');

    const totalCompletions = completions?.reduce((sum, c) => sum + c.completed_count, 0) || 0;

    return {
      data: {
        totalChallenges: totalChallenges || 0,
        activeChallenges: activeChallenges || 0,
        upcomingChallenges: upcomingChallenges || 0,
        totalParticipants: totalParticipants || 0,
        totalCompletions
      }
    };
  } catch (error) {
    console.error('Error in getChallengeStats:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Duplicate a challenge
 */
export async function duplicateChallenge(id: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to duplicate challenges' };
    }

    // Get original challenge
    const { data: original } = await supabase
      .from('loyalty_challenges')
      .select('*')
      .eq('id', id)
      .single();

    if (!original) {
      return { error: 'Challenge not found' };
    }

    // Create duplicate with updated name and dates
    const { data, error } = await supabase
      .from('loyalty_challenges')
      .insert({
        program_id: original.program_id,
        name: `${original.name} (Copy)`,
        description: original.description,
        category: original.category,
        points_value: original.points_value,
        criteria: original.criteria,
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
        max_completions: original.max_completions,
        icon: original.icon,
        sort_order: original.sort_order,
        active: false // Start as inactive
      })
      .select()
      .single();

    if (error) {
      console.error('Error duplicating challenge:', error);
      return { error: 'Failed to duplicate challenge' };
    }

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_challenge',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { 
        name: data.name, 
        duplicated_from: id,
        original_name: original.name 
      }
    });

    revalidatePath('/loyalty/admin/challenges');
    
    return { data, success: true };
  } catch (error) {
    console.error('Error in duplicateChallenge:', error);
    return { error: 'An unexpected error occurred' };
  }
}