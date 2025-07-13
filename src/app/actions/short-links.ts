'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkUserPermission } from './rbac';

// Validation schemas
const CreateShortLinkSchema = z.object({
  destination_url: z.string().url('Invalid URL'),
  link_type: z.enum(['loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom']),
  metadata: z.record(z.any()).optional(),
  expires_at: z.string().optional(),
  custom_code: z.string().optional()
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
    return { error: 'Failed to create short link' };
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
    
    // Get the short link with click data
    const { data: link, error } = await supabase
      .from('short_links')
      .select(`
        *,
        short_link_clicks(
          clicked_at,
          user_agent,
          ip_address,
          referrer
        )
      `)
      .eq('short_code', shortCode)
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