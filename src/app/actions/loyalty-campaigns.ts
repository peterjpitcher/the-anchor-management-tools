'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { LoyaltyCampaign } from '@/types/loyalty';

// Validation schemas
const CampaignFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  start_date: z.string(),
  end_date: z.string(),
  bonus_type: z.enum(['multiplier', 'fixed', 'percentage']),
  bonus_value: z.number().positive('Bonus value must be positive'),
  criteria: z.object({
    event_types: z.array(z.string()).optional(),
    min_events: z.number().optional(),
    target_tiers: z.array(z.string()).optional()
  }),
  active: z.boolean()
});

// Get all campaigns
export async function getCampaigns(filters?: {
  active?: boolean;
  current?: boolean;
}) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view campaigns' };
    }
    
    // Get the default program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not configured' };
    }
    
    let query = supabase
      .from('loyalty_campaigns')
      .select('*')
      .eq('program_id', program.id)
      .order('start_date', { ascending: false });
    
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active);
    }
    
    if (filters?.current) {
      const now = new Date().toISOString();
      query = query
        .lte('start_date', now)
        .gte('end_date', now);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load campaigns' };
    }
    
    return { data: data as LoyaltyCampaign[] };
  } catch (error) {
    console.error('Error loading campaigns:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get a single campaign
export async function getCampaign(campaignId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view campaigns' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load campaign' };
    }
    
    return { data: data as LoyaltyCampaign };
  } catch (error) {
    console.error('Error loading campaign:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Create a new campaign
export async function createCampaign(formData: z.infer<typeof CampaignFormSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to create campaigns' };
    }
    
    // Validate input
    const validatedData = CampaignFormSchema.parse(formData);
    
    // Validate dates
    if (new Date(validatedData.start_date) >= new Date(validatedData.end_date)) {
      return { error: 'End date must be after start date' };
    }
    
    // Get the default program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not configured' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_campaigns')
      .insert({
        program_id: program.id,
        name: validatedData.name,
        description: validatedData.description,
        start_date: validatedData.start_date,
        end_date: validatedData.end_date,
        bonus_type: validatedData.bonus_type,
        bonus_value: validatedData.bonus_value,
        criteria: validatedData.criteria,
        active: validatedData.active
      })
      .select()
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to create campaign' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_campaign',
      resource_id: data.id,
      operation_status: 'success',
      new_values: {
        name: data.name,
        bonus_type: data.bonus_type,
        bonus_value: data.bonus_value
      }
    });
    
    revalidatePath('/loyalty/admin/campaigns');
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Update a campaign
export async function updateCampaign(campaignId: string, formData: z.infer<typeof CampaignFormSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update campaigns' };
    }
    
    // Validate input
    const validatedData = CampaignFormSchema.parse(formData);
    
    // Validate dates
    if (new Date(validatedData.start_date) >= new Date(validatedData.end_date)) {
      return { error: 'End date must be after start date' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_campaigns')
      .update({
        name: validatedData.name,
        description: validatedData.description,
        start_date: validatedData.start_date,
        end_date: validatedData.end_date,
        bonus_type: validatedData.bonus_type,
        bonus_value: validatedData.bonus_value,
        criteria: validatedData.criteria,
        active: validatedData.active,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
      .select()
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to update campaign' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_campaign',
      resource_id: campaignId,
      operation_status: 'success',
      new_values: validatedData
    });
    
    revalidatePath('/loyalty/admin/campaigns');
    revalidatePath(`/loyalty/admin/campaigns/${campaignId}`);
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Delete a campaign
export async function deleteCampaign(campaignId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to delete campaigns' };
    }
    
    const { error } = await supabase
      .from('loyalty_campaigns')
      .delete()
      .eq('id', campaignId);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to delete campaign' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'loyalty_campaign',
      resource_id: campaignId,
      operation_status: 'success'
    });
    
    revalidatePath('/loyalty/admin/campaigns');
    
    return { success: true };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Toggle campaign active status
export async function toggleCampaignStatus(campaignId: string, active: boolean) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update campaigns' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_campaigns')
      .update({
        active,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
      .select()
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to update campaign status' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_campaign',
      resource_id: campaignId,
      operation_status: 'success',
      new_values: { active }
    });
    
    revalidatePath('/loyalty/admin/campaigns');
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get campaign statistics
export async function getCampaignStats() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view campaign statistics' };
    }
    
    const now = new Date().toISOString();
    
    // Get the default program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not configured' };
    }
    
    // Get campaign counts
    const [totalResult, activeResult, currentResult] = await Promise.all([
      supabase
        .from('loyalty_campaigns')
        .select('id', { count: 'exact' })
        .eq('program_id', program.id),
      
      supabase
        .from('loyalty_campaigns')
        .select('id', { count: 'exact' })
        .eq('program_id', program.id)
        .eq('active', true),
      
      supabase
        .from('loyalty_campaigns')
        .select('id', { count: 'exact' })
        .eq('program_id', program.id)
        .eq('active', true)
        .lte('start_date', now)
        .gte('end_date', now)
    ]);
    
    return {
      data: {
        totalCampaigns: totalResult.count || 0,
        activeCampaigns: activeResult.count || 0,
        currentCampaigns: currentResult.count || 0
      }
    };
  } catch (error) {
    console.error('Error loading campaign statistics:', error);
    return { error: 'An unexpected error occurred' };
  }
}