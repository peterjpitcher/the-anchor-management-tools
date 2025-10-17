'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';

// Validation schemas
const CreateShortLinkSchema = z.object({
  name: z.string().max(120).optional(),
  destination_url: z.string().url('Invalid URL'),
  link_type: z.enum(['loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom']),
  metadata: z.record(z.any()).optional(),
  expires_at: z.string().optional(),
  custom_code: z.string().optional()
});

const UpdateShortLinkSchema = z.object({
  id: z.string().uuid('Invalid short link'),
  name: z.string().max(120).optional().nullable(),
  destination_url: z.string().url('Invalid URL'),
  link_type: CreateShortLinkSchema.shape.link_type,
  expires_at: z.string().nullable().optional()
});

const ResolveShortLinkSchema = z.object({
  short_code: z.string().min(1, 'Short code is required')
});

// Create a short link
export async function createShortLink(data: z.infer<typeof CreateShortLinkSchema>) {
  try {
    const supabase = await createClient();
    
    // Check permissions for staff users (for now, any authenticated user can create)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Authentication required' };
    }

    const canManage = await checkUserPermission('short_links', 'manage');
    if (!canManage) {
      return { error: 'You do not have permission to manage short links' };
    }
    
    // Validate input
    const validatedData = CreateShortLinkSchema.parse(data);
    
    // Call the database function to create short link
    const { data: result, error } = await supabase
      .rpc('create_short_link', {
        p_destination_url: validatedData.destination_url,
        p_link_type: validatedData.link_type,
        p_metadata: validatedData.metadata || {},
        p_expires_at: validatedData.expires_at || null,
        p_custom_code: validatedData.custom_code || null
      })
      .single();
    
    if (error) {
      console.error('Error creating short link:', error);
      return { error: 'Failed to create short link' };
    }
    
    // If a name was provided, update the record
    if (validatedData.name && (result as any)?.short_code) {
      await supabase
        .from('short_links')
        .update({ name: validatedData.name })
        .eq('short_code', (result as any).short_code)
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'short_link',
      resource_id: (result as any)?.id,
      operation_status: 'success',
      ...(user && { user_id: user.id }),
      additional_info: {
        short_code: (result as any)?.short_code,
        destination: validatedData.destination_url,
        link_type: validatedData.link_type
      }
    });

    revalidatePath('/short-links');

    return { 
      success: true, 
      data: {
        short_code: (result as any).short_code,
        full_url: (result as any).full_url
      }
    };
  } catch (error) {
    console.error('Short link creation error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

export async function getShortLinks() {
  try {
    const supabase = await createClient();

    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short links' };
    }

    const { data, error } = await supabase
      .from('short_links')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching short links:', error);
      return { error: 'Failed to load short links' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Failed to list short links:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function updateShortLink(input: z.infer<typeof UpdateShortLinkSchema>) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Authentication required' };
    }

    const canManage = await checkUserPermission('short_links', 'manage');
    if (!canManage) {
      return { error: 'You do not have permission to manage short links' };
    }

    const validated = UpdateShortLinkSchema.parse(input);

    const { data: updated, error } = await supabase
      .from('short_links')
      .update({
        name: validated.name ?? null,
        destination_url: validated.destination_url,
        link_type: validated.link_type,
        expires_at: validated.expires_at ?? null,
        updated_at: new Date().toISOString()
      })
      .eq('id', validated.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating short link:', error);
      return { error: 'Failed to update short link' };
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'short_link',
      resource_id: validated.id,
      operation_status: 'success',
      user_id: user.id,
      new_values: {
        destination_url: validated.destination_url,
        link_type: validated.link_type,
        expires_at: validated.expires_at
      }
    });

    revalidatePath('/short-links');

    return { success: true, data: updated };
  } catch (error) {
    console.error('Short link update error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

export async function deleteShortLink(id: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Authentication required' };
    }

    const canManage = await checkUserPermission('short_links', 'manage');
    if (!canManage) {
      return { error: 'You do not have permission to manage short links' };
    }

    const { data: existing, error: fetchError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error loading short link before delete:', fetchError);
      return { error: 'Failed to load short link' };
    }

    if (!existing) {
      return { error: 'Short link not found' };
    }

    const { error } = await supabase
      .from('short_links')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting short link:', error);
      return { error: 'Failed to delete short link' };
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'short_link',
      resource_id: id,
      operation_status: 'success',
      user_id: user.id,
      old_values: {
        short_code: existing.short_code,
        destination_url: existing.destination_url
      }
    });

    revalidatePath('/short-links');

    return { success: true };
  } catch (error) {
    console.error('Short link delete error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Create a short link without authentication (for system use)
export async function createShortLinkInternal(data: {
  destination_url: string;
  link_type: string;
  metadata?: Record<string, any>;
  expires_at?: string;
}) {
  try {
    const supabase = await createAdminClient();
    
    // Generate short code
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let shortCode = '';
    for (let i = 0; i < 6; i++) {
      shortCode += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // Insert directly with admin client
    const { data: link, error } = await supabase
      .from('short_links')
      .insert({
        short_code: shortCode,
        destination_url: data.destination_url,
        link_type: data.link_type,
        metadata: data.metadata || {},
        expires_at: data.expires_at || null
      })
      .select()
      .single();
    
    if (error) {
      // If duplicate, try again with different code
      if (error.code === '23505') {
        return createShortLinkInternal(data);
      }
      throw error;
    }
    
    return {
      success: true,
      data: {
        short_code: link.short_code,
        full_url: `https://vip-club.uk/${link.short_code}`
      }
    };
  } catch (error) {
    console.error('Internal short link error:', error);
    return { error: `Failed to create short link: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Resolve a short link to its destination
export async function resolveShortLink(data: z.infer<typeof ResolveShortLinkSchema>) {
  try {
    const supabase = await createAdminClient();
    
    // Validate input
    const validatedData = ResolveShortLinkSchema.parse(data);
    
    // Get the short link
    const { data: link, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('short_code', validatedData.short_code)
      .single();
    
    if (error || !link) {
      return { error: 'Short link not found' };
    }
    
    // Check if expired
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { error: 'This link has expired' };
    }
    
    // Track the click (fire and forget)
    supabase
      .from('short_link_clicks')
      .insert({
        short_link_id: link.id
      })
      .then(() => {
        // Update click count
        supabase
          .from('short_links')
          .update({
            click_count: (link.click_count || 0) + 1,
            last_clicked_at: new Date().toISOString()
          })
          .eq('id', link.id)
          .then(() => {});
      });
    
    return {
      success: true,
      data: {
        destination_url: link.destination_url,
        link_type: link.link_type,
        metadata: link.metadata
      }
    };
  } catch (error) {
    console.error('Short link resolution error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Get analytics for a short link
export async function getShortLinkAnalytics(shortCode: string) {
  try {
    const supabase = await createClient();
    
    // Check authentication (for now, any authenticated user can view)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Authentication required' };
    }

    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }
    
    // Get the short link with click data
    const { data: link, error } = await supabase
      .from('short_links')
      .select(`
        *,
        short_link_clicks(
          clicked_at,
          user_agent,
          ip_address,
          referrer,
          country,
          city,
          device_type,
          browser,
          os
        )
      `)
      .eq('short_code', shortCode)
      .order('clicked_at', { ascending: false, foreignTable: 'short_link_clicks' })
      .single();
    
    if (error || !link) {
      return { error: 'Short link not found' };
    }
    
    return { success: true, data: link };
  } catch (error) {
    console.error('Analytics error:', error);
    return { error: 'Failed to load analytics' };
  }
}

export async function getShortLinkAnalyticsSummary(shortCode: string, days: number = 30) {
  try {
    const supabase = await createClient();

    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }

    const { data, error } = await (supabase as any)
      .rpc('get_short_link_analytics', {
        p_short_code: shortCode,
        p_days: days
      });

    if (error) {
      console.error('Error fetching analytics summary:', error);
      return { error: 'Failed to load analytics summary' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Analytics summary error:', error);
    return { error: 'Failed to load analytics summary' };
  }
}

export async function getShortLinkVolume(days: number = 30) {
  try {
    const supabase = await createClient();

    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }

    const { data, error } = await (supabase as any)
      .rpc('get_all_links_analytics', {
        p_days: days
      });

    if (error) {
      console.error('Error fetching volume analytics:', error);
      return { error: 'Failed to load analytics' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Short link volume error:', error);
    return { error: 'Failed to load analytics' };
  }
}
