import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
import { resolveShortLinkName } from '@/lib/short-links/names';
import {
  SHORT_LINK_INSIGHTS_TIMEZONE,
  type ShortLinkInsightsGranularity,
  validateInsightsRange,
} from '@/lib/short-link-insights-timeframes';

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
  destination_url: z.string().trim().url('Invalid URL'),
  link_type: z.enum(['loyalty_portal', 'promotion', 'reward_redemption', 'custom', 'booking_confirmation', 'event_checkin']),
  metadata: z.record(z.any()).optional(),
  expires_at: z.string().nullable().optional(),
  custom_code: CustomCodeSchema.optional()
});

export const UpdateShortLinkSchema = z.object({
  id: z.string().uuid('Invalid short link'),
  name: z.string().max(120).optional().nullable(),
  destination_url: z.string().trim().url('Invalid URL'),
  link_type: CreateShortLinkSchema.shape.link_type,
  expires_at: z.string().nullable().optional()
});

export const ShortLinkVolumeGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);

export const GetShortLinkVolumeAdvancedSchema = z.object({
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  granularity: ShortLinkVolumeGranularitySchema,
  include_bots: z.boolean().optional().default(false),
  timezone: z.string().trim().min(1).max(64).optional().default(SHORT_LINK_INSIGHTS_TIMEZONE),
}).superRefine((value, context) => {
  const validation = validateInsightsRange(
    new Date(value.start_at),
    new Date(value.end_at),
    value.granularity as ShortLinkInsightsGranularity
  );

  if (!validation.valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.error,
      path: ['start_at'],
    });
  }
});

export type CreateShortLinkInput = z.infer<typeof CreateShortLinkSchema>;
export type UpdateShortLinkInput = z.infer<typeof UpdateShortLinkSchema>;
export type GetShortLinkVolumeAdvancedInput = z.infer<typeof GetShortLinkVolumeAdvancedSchema>;

export class ShortLinkService {
  private static async findShortLinkByDestinationUrl(
    supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
    destinationUrl: string
  ) {
    const { data, error } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, name, created_at')
      .eq('destination_url', destinationUrl)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error('Failed to check for existing short links');
    return data;
  }

  static async createShortLink(data: CreateShortLinkInput): Promise<{
    id: string;
    short_code: string;
    full_url: string;
    already_exists: boolean;
  }> {
    const supabase = await createClient();
    const linkName = resolveShortLinkName(data.name, data.destination_url);

    const existing = await this.findShortLinkByDestinationUrl(supabase, data.destination_url);
    if (existing) {
      if (!existing.name?.trim()) {
        await createAdminClient()
          .from('short_links')
          .update({ name: linkName })
          .eq('id', existing.id);
      }

      return {
        id: existing.id,
        short_code: existing.short_code,
        full_url: buildShortLinkUrl(existing.short_code),
        already_exists: true,
      };
    }
    
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
      if (error.code === '23505') {
        throw new Error('Custom code already in use. Please choose another.');
      }
      if (error.code === 'PGRST203') {
        throw new Error('Short link creation is temporarily unavailable (database RPC overload). Please apply the latest Supabase migrations.');
      }
      throw new Error(error.message || 'Failed to create short link');
    }

    const rpcResult = result as Record<string, unknown> | null;
    if (rpcResult?.short_code) {
      await createAdminClient()
        .from('short_links')
        .update({ name: linkName })
        .eq('short_code', rpcResult.short_code as string);
    }

    const shortCode = rpcResult?.short_code as string;

    const { data: linkRow } = await supabase
      .from('short_links')
      .select('id')
      .eq('short_code', shortCode)
      .maybeSingle();

    return {
      id: linkRow?.id ?? '',
      short_code: shortCode,
      full_url: buildShortLinkUrl(shortCode),
      already_exists: false,
    };
  }

  static async getShortLinks(page: number = 1, pageSize: number = 50, includeSystem: boolean = false, search?: string): Promise<{
    data: unknown[];
    total: number;
    linkTotal: number;
    page: number;
    pageSize: number;
  }> {
    const supabase = await createClient();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let countQuery = supabase
      .from('short_links')
      .select('id', { count: 'exact', head: true });

    let parentQuery = supabase
      .from('short_links')
      .select('*', { count: 'exact' })
      .is('parent_link_id', null)
      .order('created_at', { ascending: false });

    if (!includeSystem) {
      countQuery = countQuery.not('created_by', 'is', null);
      parentQuery = parentQuery.not('created_by', 'is', null);
    }

    if (search) {
      const term = `%${search}%`;
      const searchFilter = `name.ilike.${term},short_code.ilike.${term},destination_url.ilike.${term}`;
      countQuery = countQuery.or(searchFilter);
      parentQuery = parentQuery.or(searchFilter);
    }

    const [
      { count: linkTotal, error: countError },
      { data: parents, error: parentError, count },
    ] = await Promise.all([
      countQuery,
      parentQuery.range(from, to),
    ]);

    if (countError || parentError) throw new Error('Failed to load short links');

    const parentRows = parents || [];
    const parentIds = parentRows.map((link) => link.id);
    let variants: unknown[] = [];

    if (parentIds.length > 0) {
      let variantQuery = supabase
        .from('short_links')
        .select('*')
        .in('parent_link_id', parentIds)
        .order('created_at', { ascending: false });

      if (!includeSystem) {
        variantQuery = variantQuery.not('created_by', 'is', null);
      }

      const { data: variantRows, error: variantError } = await variantQuery;
      if (variantError) throw new Error('Failed to load short link variants');
      variants = variantRows || [];
    }

    return {
      data: [...parentRows, ...variants],
      total: count || 0,
      linkTotal: linkTotal || 0,
      page,
      pageSize,
    };
  }

  static async updateShortLink(input: UpdateShortLinkInput) {
    const supabase = createAdminClient();
    const linkName = resolveShortLinkName(input.name, input.destination_url);

    const conflict = await this.findShortLinkByDestinationUrl(supabase, input.destination_url);
    if (conflict && conflict.id !== input.id) {
      throw new Error(
        `A short link already exists for this URL (${buildShortLinkUrl(conflict.short_code)}).`
      );
    }

    const { data: updated, error } = await supabase
      .from('short_links')
      .update({
        name: linkName,
        destination_url: input.destination_url,
        link_type: input.link_type,
        expires_at: input.expires_at ?? null,
        updated_at: new Date().toISOString()
      })
      .eq('id', input.id)
      .select()
      .maybeSingle();

    if (error) throw new Error('Failed to update short link');
    if (!updated) throw new Error('Short link not found');
    return updated;
  }

  static async deleteShortLink(id: string) {
    const supabase = createAdminClient();
    
    const { data: existing, error: fetchError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw new Error('Failed to load short link');
    if (!existing) throw new Error('Short link not found');

    const { data: deletedLink, error } = await supabase
      .from('short_links')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) throw new Error('Failed to delete short link');
    if (!deletedLink) throw new Error('Short link not found');

    return existing;
  }

  static async createShortLinkInternal(data: {
    destination_url: string;
    link_type: string;
    metadata?: Record<string, any>;
    expires_at?: string;
    name?: string;
  }): Promise<{ short_code: string; full_url: string; already_exists: boolean }> {
    const supabase = await createAdminClient();
    const linkName = resolveShortLinkName(data.name, data.destination_url);

    const existing = await this.findShortLinkByDestinationUrl(supabase, data.destination_url);
    if (existing) {
      if (!existing.name?.trim()) {
        await supabase
          .from('short_links')
          .update({ name: linkName })
          .eq('id', existing.id);
      }

      return {
        short_code: existing.short_code,
        full_url: buildShortLinkUrl(existing.short_code),
        already_exists: true,
      };
    }

    const { data: result, error } = await supabase
      .rpc('create_short_link', {
        p_destination_url: data.destination_url,
        p_link_type: data.link_type,
        p_metadata: data.metadata || {},
        p_expires_at: data.expires_at || null,
        p_custom_code: null,
      })
      .single();

    if (error) {
      if (error.code === '23505') {
        return this.createShortLinkInternal(data);
      }
      throw new Error(error.message || 'Failed to create short link');
    }

    const shortCode = (result as Record<string, unknown>)?.short_code as string;
    await supabase
      .from('short_links')
      .update({ name: linkName })
      .eq('short_code', shortCode);

    return {
      short_code: shortCode,
      full_url: buildShortLinkUrl(shortCode),
      already_exists: false,
    };
  }

  static async getOrCreateUtmVariant(
    parentId: string,
    channelKey: string
  ): Promise<{ id: string; short_code: string; full_url: string; already_exists: boolean }> {
    const { CHANNEL_MAP } = await import('@/lib/short-links/channels');
    const { buildUtmUrl, buildVariantName } = await import('@/lib/short-links/utm');

    const channel = CHANNEL_MAP.get(channelKey);
    if (!channel) throw new Error(`Unknown channel: ${channelKey}`);

    const supabase = await createClient();

    // Fetch parent link
    const { data: parent, error: parentError } = await supabase
      .from('short_links')
      .select('id, name, destination_url, link_type, expires_at')
      .eq('id', parentId)
      .single();

    if (parentError || !parent) throw new Error('Parent link not found');

    const utmDestination = buildUtmUrl(parent.destination_url, channel, parent.name || parent.id);
    const variantName = buildVariantName(parent.name || `/${parent.id.slice(0, 6)}`, channel.label);

    // Check for existing variant by channel (more robust than URL matching)
    const { data: existing } = await supabase
      .from('short_links')
      .select('id, short_code')
      .eq('parent_link_id', parentId)
      .contains('metadata', { channel: channelKey })
      .maybeSingle();

    if (existing) {
      return {
        id: existing.id,
        short_code: existing.short_code,
        full_url: buildShortLinkUrl(existing.short_code),
        already_exists: true,
      };
    }

    // Create new variant via RPC
    const { data: result, error: createError } = await supabase
      .rpc('create_short_link', {
        p_destination_url: utmDestination,
        p_link_type: parent.link_type,
        p_metadata: { channel: channelKey, parent_link_id: parentId, utm_variant: true },
        p_expires_at: parent.expires_at || null,
        p_custom_code: null,
      })
      .single();

    if (createError) throw new Error(createError.message || 'Failed to create variant');

    const shortCode = (result as Record<string, unknown>)?.short_code as string;

    // Set parent_link_id and name on the new variant
    await supabase
      .from('short_links')
      .update({ parent_link_id: parentId, name: variantName })
      .eq('short_code', shortCode);

    // Fetch the created link's ID
    const { data: created } = await supabase
      .from('short_links')
      .select('id')
      .eq('short_code', shortCode)
      .single();

    return {
      id: created?.id || '',
      short_code: shortCode,
      full_url: buildShortLinkUrl(shortCode),
      already_exists: false,
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

    const { data, error } = await supabase
      .rpc('get_short_link_analytics', {
        p_short_code: shortCode,
        p_days: days
      });

    if (error) throw new Error('Failed to load analytics summary');

    return data;
  }

  static async getShortLinkVolume(days: number = 30) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .rpc('get_all_links_analytics', {
        p_days: days
      });

    if (error) throw new Error('Failed to load analytics');

    return data;
  }

  static async getShortLinkVolumeAdvanced(input: GetShortLinkVolumeAdvancedInput) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .rpc('get_all_links_analytics_v2', {
        p_start_at: input.start_at,
        p_end_at: input.end_at,
        p_granularity: input.granularity,
        p_include_bots: input.include_bots ?? false,
        p_timezone: input.timezone ?? SHORT_LINK_INSIGHTS_TIMEZONE,
      });

    if (error) throw new Error('Failed to load analytics');

    return data;
  }
}
