'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';
import { ShortLinkService, CreateShortLinkSchema, UpdateShortLinkSchema, ResolveShortLinkSchema } from '@/services/short-links';

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
    
    const result = await ShortLinkService.createShortLink(validatedData);

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'short_link',
      resource_id: result.id,
      operation_status: 'success',
      user_id: user.id,
      additional_info: {
        short_code: result.short_code,
        destination: validatedData.destination_url,
        link_type: validatedData.link_type
      }
    });

    revalidatePath('/short-links');

    return { 
      success: true, 
      data: {
        short_code: result.short_code,
        full_url: result.full_url
      }
    };
  } catch (error: any) {
    console.error('Short link creation error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function getShortLinks() {
  try {
    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short links' };
    }

    const data = await ShortLinkService.getShortLinks();
    return { success: true, data };
  } catch (error: any) {
    console.error('Failed to list short links:', error);
    return { error: error.message || 'An unexpected error occurred' };
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
    const updated = await ShortLinkService.updateShortLink(validated);

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
  } catch (error: any) {
    console.error('Short link update error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: error.message || 'An unexpected error occurred' };
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

    const existing = await ShortLinkService.deleteShortLink(id);

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
  } catch (error: any) {
    console.error('Short link delete error:', error);
    return { error: error.message || 'An unexpected error occurred' };
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
    const result = await ShortLinkService.createShortLinkInternal(data);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('Internal short link error:', error);
    return { error: `Failed to create short link: ${error.message}` };
  }
}

// Resolve a short link to its destination
export async function resolveShortLink(data: z.infer<typeof ResolveShortLinkSchema>) {
  try {
    const validatedData = ResolveShortLinkSchema.parse(data);
    const result = await ShortLinkService.resolveShortLink(validatedData);
    return { success: true, data: result };
  } catch (error: any) {
    console.error('Short link resolution error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Get analytics for a short link
export async function getShortLinkAnalytics(shortCode: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Authentication required' };
    }

    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }
    
    const data = await ShortLinkService.getShortLinkAnalytics(shortCode);
    return { success: true, data };
  } catch (error: any) {
    console.error('Analytics error:', error);
    return { error: error.message || 'Failed to load analytics' };
  }
}

export async function getShortLinkAnalyticsSummary(shortCode: string, days: number = 30) {
  try {
    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }

    const data = await ShortLinkService.getShortLinkAnalyticsSummary(shortCode, days);
    return { success: true, data };
  } catch (error: any) {
    console.error('Analytics summary error:', error);
    return { error: error.message || 'Failed to load analytics summary' };
  }
}

export async function getShortLinkVolume(days: number = 30) {
  try {
    const canView = await checkUserPermission('short_links', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view short link analytics' };
    }

    const data = await ShortLinkService.getShortLinkVolume(days);
    return { success: true, data };
  } catch (error: any) {
    console.error('Short link volume error:', error);
    return { error: error.message || 'Failed to load analytics' };
  }
}