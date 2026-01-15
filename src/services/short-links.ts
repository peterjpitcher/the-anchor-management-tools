import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';

// Validation schemas
const CustomCodeSchema = z
  .string()
  .trim()
  .min(3, 'Custom code must be at least 3 characters')
  .max(20, 'Custom code must be 20 characters or fewer')
  .regex(/^[a-z0-9-]+$/i, 'Custom code can only contain letters, numbers, and hyphens')
  .transform((value) => value.toLowerCase());

export const CreateShortLinkSchema = z.object({
  name: z.string().max(120).optional(),
  destination_url: z.string().url('Invalid URL'),
  link_type: z.enum(['loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom', 'booking_confirmation']),
  metadata: z.record(z.any()).optional(),
  expires_at: z.string().nullable().optional(),
  custom_code: CustomCodeSchema.optional()
});

export const UpdateShortLinkSchema = z.object({
  id: z.string().uuid('Invalid short link'),
  name: z.string().max(120).optional().nullable(),
  destination_url: z.string().url('Invalid URL'),
  link_type: CreateShortLinkSchema.shape.link_type,
  expires_at: z.string().nullable().optional()
});

export const ResolveShortLinkSchema = z.object({
  short_code: z.string().min(1, 'Short code is required')
});

export type CreateShortLinkInput = z.infer<typeof CreateShortLinkSchema>;
export type UpdateShortLinkInput = z.infer<typeof UpdateShortLinkSchema>;
export type ResolveShortLinkInput = z.infer<typeof ResolveShortLinkSchema>;

export class ShortLinkService {
  static async createShortLink(data: CreateShortLinkInput) {
    const supabase = await createClient();
    
    const { data: result, error } = await supabase
      .rpc('create_short_link', {
        p_destination_url: data.destination_url,
        p_link_type: data.link_type,
        p_metadata: data.metadata || {},
        p_expires_at: data.expires_at || null,
        p_custom_code: data.custom_code || null
      })
      .single();
    
    if (error) {
      if ((error as any)?.code === '23505') {
        throw new Error('Custom code already in use. Please choose another.');
      }
      throw new Error('Failed to create short link');
    }
    
    if (data.name && (result as any)?.short_code) {
      await supabase
        .from('short_links')
        .update({ name: data.name })
        .eq('short_code', (result as any).short_code);
    }

    const shortCode = (result as any).short_code as string;

    const { data: linkRow, error: linkFetchError } = await supabase
      .from('short_links')
      .select('id')
      .eq('short_code', shortCode)
      .single();

    if (linkFetchError) {
      throw new Error('Failed to load created short link');
    }

    return {
      id: linkRow.id,
      short_code: shortCode,
      full_url: buildShortLinkUrl(shortCode)
    };
  }

  static async getShortLinks() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('short_links')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error('Failed to load short links');
    return data;
  }

  static async updateShortLink(input: UpdateShortLinkInput) {
    const supabase = await createClient();
    const { data: updated, error } = await supabase
      .from('short_links')
      .update({
        name: input.name ?? null,
        destination_url: input.destination_url,
        link_type: input.link_type,
        expires_at: input.expires_at ?? null,
        updated_at: new Date().toISOString()
      })
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new Error('Failed to update short link');
    return updated;
  }

  static async deleteShortLink(id: string) {
    const supabase = await createClient();
    
    const { data: existing, error: fetchError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw new Error('Failed to load short link');
    if (!existing) throw new Error('Short link not found');

    const { error } = await supabase
      .from('short_links')
      .delete()
      .eq('id', id);

    if (error) throw new Error('Failed to delete short link');

    return existing;
  }

  static async createShortLinkInternal(data: {
    destination_url: string;
    link_type: string;
    metadata?: Record<string, any>;
    expires_at?: string;
  }): Promise<{ short_code: string; full_url: string }> {
    const supabase = await createAdminClient();
    
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let shortCode = '';
    for (let i = 0; i < 6; i++) {
      shortCode += chars[Math.floor(Math.random() * chars.length)];
    }
    
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
      if (error.code === '23505') {
        return this.createShortLinkInternal(data);
      }
      throw error;
    }
    
    return {
      short_code: link.short_code,
      full_url: buildShortLinkUrl(link.short_code)
    };
  }

  static async resolveShortLink(input: ResolveShortLinkInput) {
    const supabase = await createAdminClient();
    
    const { data: link, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('short_code', input.short_code)
      .single();
    
    if (error || !link) throw new Error('Short link not found');
    
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new Error('This link has expired');
    }
    
    // Track the click (fire and forget)
    supabase
      .from('short_link_clicks')
      .insert({
        short_link_id: link.id
      })
      .then(async () => {
        await (supabase as any).rpc('increment_short_link_clicks', {
          p_short_link_id: link.id
        });
      });
    
    return {
      destination_url: link.destination_url,
      link_type: link.link_type,
      metadata: link.metadata
    };
  }

  static async getShortLinkAnalytics(shortCode: string) {
    const supabase = await createClient();
    
    const { data: link, error } = await supabase
      .from('short_links')
      .select('id, short_code, link_type, destination_url, click_count, last_clicked_at, metadata')
      .eq('short_code', shortCode)
      .single();
    
    if (error || !link) throw new Error('Short link not found');
    
    return link;
  }

  static async getShortLinkAnalyticsSummary(shortCode: string, days: number = 30) {
    const supabase = await createClient();

    const { data, error } = await (supabase as any)
      .rpc('get_short_link_analytics', {
        p_short_code: shortCode,
        p_days: days
      });

    if (error) throw new Error('Failed to load analytics summary');

    return data;
  }

  static async getShortLinkVolume(days: number = 30) {
    const supabase = await createClient();

    const { data, error } = await (supabase as any)
      .rpc('get_all_links_analytics', {
        p_days: days
      });

    if (error) throw new Error('Failed to load analytics');

    return data;
  }
}
