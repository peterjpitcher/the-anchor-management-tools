import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
import { assertAllowedShortLinkDestination } from '@/lib/short-links/destination-allowlist';
import { resolveShortLinkName } from '@/lib/short-links/names';
import {
  SHORT_LINK_INSIGHTS_TIMEZONE,
  type ShortLinkInsightsGranularity,
  validateInsightsRange,
} from '@/lib/short-link-insights-timeframes';
import type {
  LegacyDomainLinkUsage,
  LegacyDomainRecentClick,
  LegacyDomainUsage,
} from '@/types/short-links';

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

const ShortLinkVolumeGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);

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

type ShortLinkVariantRow = {
  id: string;
  short_code: string;
  destination_url: string;
  metadata: Record<string, unknown> | null;
};

type ShortLinkParentRow = {
  id: string;
  short_code: string;
  destination_url: string;
  link_type: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

type LegacyDomainShortLinkRow = {
  id: string;
  short_code: string;
  name: string | null;
  destination_url: string | null;
  link_type: string | null;
  metadata: Record<string, unknown> | null;
  click_count: number | null;
  last_clicked_at: string | null;
};

type LegacyDomainClickRow = {
  id: string;
  clicked_at: string | null;
  device_type: string | null;
  request_host?: string | null;
  short_link_id: string | null;
  short_links: LegacyDomainShortLinkRow | LegacyDomainShortLinkRow[] | null;
};

const LEGACY_SHORT_LINK_HOSTS = new Set(['vip-club.uk', 'www.vip-club.uk']);
const CANONICAL_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'the-anchor.pub', 'www.the-anchor.pub']);
const LEGACY_USAGE_PAGE_SIZE = 1000;
const LEGACY_USAGE_MAX_ROWS = 50000;

function normalizeShortCode(value: string): string {
  const normalized = value.trim().replace(/^\//, '').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error('Parent short code is invalid');
  }
  return normalized;
}

function withUtmContent(destinationUrl: string, utmContent: string): string {
  const url = new URL(destinationUrl);
  url.searchParams.set('utm_content', utmContent.trim().toLowerCase());
  return url.toString();
}

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.split(':')[0]?.trim().toLowerCase();
  return normalized || null;
}

function isLegacyShortLinkHost(value: unknown): boolean {
  const normalized = normalizeHost(value);
  if (!normalized) return false;
  return LEGACY_SHORT_LINK_HOSTS.has(normalized) || normalized.endsWith('.vip-club.uk');
}

function isCanonicalShortLinkHost(value: unknown): boolean {
  const normalized = normalizeHost(value);
  if (!normalized) return false;
  return CANONICAL_SHORT_LINK_HOSTS.has(normalized);
}

function isHumanClick(row: LegacyDomainClickRow): boolean {
  return row.device_type !== 'bot';
}

function parseDestinationUrl(value: string | null): { host: string | null; path: string | null } {
  if (!value) return { host: null, path: null };

  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { host: null, path: value };
  }
}

function getRelatedShortLink(row: LegacyDomainClickRow): LegacyDomainShortLinkRow | null {
  if (Array.isArray(row.short_links)) {
    return row.short_links[0] ?? null;
  }
  return row.short_links ?? null;
}

function addClickToLinkUsage(
  map: Map<string, LegacyDomainLinkUsage>,
  row: LegacyDomainClickRow,
  human: boolean
): void {
  const link = getRelatedShortLink(row);
  const shortCode = link?.short_code || row.short_link_id || 'unknown';
  const mapKey = link?.id || row.short_link_id || shortCode;
  const destination = parseDestinationUrl(link?.destination_url ?? null);
  const metadata: Record<string, unknown> = link?.metadata && typeof link.metadata === 'object' && !Array.isArray(link.metadata)
    ? link.metadata
    : {};
  const existing = map.get(mapKey);

  if (existing) {
    existing.totalClicks += 1;
    if (human) existing.humanClicks += 1;
    if (
      row.clicked_at &&
      (!existing.lastClickedAt || Date.parse(row.clicked_at) > Date.parse(existing.lastClickedAt))
    ) {
      existing.lastClickedAt = row.clicked_at;
    }
    return;
  }

  map.set(mapKey, {
    shortCode,
    name: link?.name ?? null,
    linkType: link?.link_type ?? null,
    destinationUrl: link?.destination_url ?? null,
    destinationHost: destination.host,
    destinationPath: destination.path,
    channel: typeof metadata.channel === 'string' ? metadata.channel : null,
    source: typeof metadata.source === 'string' ? metadata.source : null,
    eventId: typeof metadata.event_id === 'string' ? metadata.event_id : null,
    totalClicks: 1,
    humanClicks: human ? 1 : 0,
    lastClickedAt: row.clicked_at,
    allTimeClickCount: link?.click_count ?? 0,
  });
}

function sortLinkUsageRows(rows: LegacyDomainLinkUsage[]): LegacyDomainLinkUsage[] {
  return rows.sort((left, right) => {
    if (right.humanClicks !== left.humanClicks) return right.humanClicks - left.humanClicks;
    if (right.totalClicks !== left.totalClicks) return right.totalClicks - left.totalClicks;
    return Date.parse(right.lastClickedAt || '') - Date.parse(left.lastClickedAt || '');
  });
}

function isMissingRequestHostColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message || '');
  return code === '42703' || message.includes('request_host');
}

async function fetchLegacyUsageClickRows(startAt: string): Promise<{
  rows: LegacyDomainClickRow[];
  trackingColumnReady: boolean;
}> {
  const supabase = createAdminClient();
  const rows: LegacyDomainClickRow[] = [];

  async function fetchPage(from: number, to: number, includeRequestHost: boolean) {
    const select = includeRequestHost
      ? 'id,clicked_at,device_type,request_host,short_link_id,short_links(id,short_code,name,destination_url,link_type,metadata,click_count,last_clicked_at)'
      : 'id,clicked_at,device_type,short_link_id,short_links(id,short_code,name,destination_url,link_type,metadata,click_count,last_clicked_at)';

    return (supabase
      .from('short_link_clicks')
      .select(select)
      .gte('clicked_at', startAt)
      .order('clicked_at', { ascending: false })
      .range(from, to) as any);
  }

  let trackingColumnReady = true;

  for (let offset = 0; offset < LEGACY_USAGE_MAX_ROWS; offset += LEGACY_USAGE_PAGE_SIZE) {
    const from = offset;
    const to = offset + LEGACY_USAGE_PAGE_SIZE - 1;
    let { data, error } = await fetchPage(from, to, trackingColumnReady);

    if (error && trackingColumnReady && isMissingRequestHostColumn(error)) {
      trackingColumnReady = false;
      rows.length = 0;
      const retry = await fetchPage(0, LEGACY_USAGE_PAGE_SIZE - 1, false);
      data = retry.data;
      error = retry.error;
    }

    if (error) throw new Error('Failed to load legacy domain usage');

    const pageRows = (data || []) as unknown as LegacyDomainClickRow[];
    rows.push(...pageRows);

    if (pageRows.length < LEGACY_USAGE_PAGE_SIZE) break;
  }

  return { rows, trackingColumnReady };
}

export class ShortLinkService {
  private static async findShortLinkByDestinationUrl(
    supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
    destinationUrl: string
  ) {
    const { data, error } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, name, created_by, created_at')
      .eq('destination_url', destinationUrl)
      .is('parent_link_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error('Failed to check for existing short links');
    return data;
  }

  private static async findShortLinkByShortCode(
    supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
    shortCode: string
  ): Promise<ShortLinkParentRow | null> {
    const { data, error } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, link_type, expires_at, metadata')
      .eq('short_code', normalizeShortCode(shortCode))
      .maybeSingle();

    if (error) throw new Error('Failed to load parent short link');
    return (data ?? null) as ShortLinkParentRow | null;
  }

  static async createShortLink(data: CreateShortLinkInput, createdBy?: string): Promise<{
    id: string;
    short_code: string;
    full_url: string;
    already_exists: boolean;
  }> {
    const supabase = await createClient();
    const destinationUrl = assertAllowedShortLinkDestination(data.destination_url);
    const linkName = resolveShortLinkName(data.name, destinationUrl);

    const existing = await this.findShortLinkByDestinationUrl(supabase, destinationUrl);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.name?.trim()) {
        patch.name = linkName;
      }
      if (createdBy && !existing.created_by) {
        patch.created_by = createdBy;
      }

      if (Object.keys(patch).length > 0) {
        await createAdminClient()
          .from('short_links')
          .update(patch)
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
        p_destination_url: destinationUrl,
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
        .update({ name: linkName, ...(createdBy ? { created_by: createdBy } : {}) })
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
      .select('id', { count: 'exact', head: true })
      .is('parent_link_id', null);

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
    const destinationUrl = assertAllowedShortLinkDestination(input.destination_url);
    const linkName = resolveShortLinkName(input.name, destinationUrl);

    const conflict = await this.findShortLinkByDestinationUrl(supabase, destinationUrl);
    if (conflict && conflict.id !== input.id) {
      throw new Error(
        `A short link already exists for this URL (${buildShortLinkUrl(conflict.short_code)}).`
      );
    }

    const { data: updated, error } = await supabase
      .from('short_links')
      .update({
        name: linkName,
        destination_url: destinationUrl,
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
    const destinationUrl = assertAllowedShortLinkDestination(data.destination_url);
    const linkName = resolveShortLinkName(data.name, destinationUrl);

    const existing = await this.findShortLinkByDestinationUrl(supabase, destinationUrl);
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
        p_destination_url: destinationUrl,
        p_link_type: data.link_type,
        p_metadata: data.metadata || {},
        p_expires_at: data.expires_at || null,
        p_custom_code: null,
      })
      .single();

    if (error) {
      if (error.code === '23505') {
        return this.createShortLinkInternal({ ...data, destination_url: destinationUrl });
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

  static async getOrCreateShortLinkVariantInternal(data: {
    parent_short_code: string;
    destination_url?: string;
    utm_content: string;
    name?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    id: string;
    short_code: string;
    full_url: string;
    destination_url: string;
    already_exists: boolean;
  }> {
    const supabase = createAdminClient();
    const parent = await this.findShortLinkByShortCode(supabase, data.parent_short_code);
    if (!parent) {
      throw new Error('Parent short link not found');
    }

    const utmContent = data.utm_content.trim().toLowerCase();
    const destinationUrl = withUtmContent(data.destination_url || parent.destination_url, utmContent);
    assertAllowedShortLinkDestination(destinationUrl);
    const metadata = {
      ...(parent.metadata?.event_id ? { event_id: parent.metadata.event_id } : {}),
      channel: 'meta_ads',
      parent_link_id: parent.id,
      parent_short_code: parent.short_code,
      utm_variant: true,
      utm_content: utmContent,
      ...(data.metadata || {}),
    };

    const { data: existingRows, error: existingError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, metadata')
      .eq('parent_link_id', parent.id)
      .contains('metadata', { channel: 'meta_ads', utm_content: utmContent });

    if (existingError) throw new Error('Failed to check for existing short link variant');

    const existing = Array.isArray(existingRows) && existingRows.length > 0
      ? existingRows[0] as ShortLinkVariantRow
      : null;

    if (existing) {
      if (existing.destination_url !== destinationUrl) {
        await supabase
          .from('short_links')
          .update({
            destination_url: destinationUrl,
            metadata: { ...(existing.metadata || {}), ...metadata },
            name: data.name || `Meta ad ${utmContent}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }

      return {
        id: existing.id,
        short_code: existing.short_code,
        full_url: buildShortLinkUrl(existing.short_code),
        destination_url: destinationUrl,
        already_exists: true,
      };
    }

    const { data: result, error: createError } = await supabase
      .rpc('create_short_link', {
        p_destination_url: destinationUrl,
        p_link_type: parent.link_type || 'custom',
        p_metadata: metadata,
        p_expires_at: parent.expires_at || null,
        p_custom_code: null,
      })
      .single();

    if (createError) throw new Error(createError.message || 'Failed to create short link variant');

    const shortCode = (result as Record<string, unknown>)?.short_code as string;
    await supabase
      .from('short_links')
      .update({
        parent_link_id: parent.id,
        name: data.name || `Meta ad ${utmContent}`,
        metadata,
      })
      .eq('short_code', shortCode);

    const { data: created } = await supabase
      .from('short_links')
      .select('id')
      .eq('short_code', shortCode)
      .maybeSingle();

    return {
      id: (created as { id?: string } | null)?.id || '',
      short_code: shortCode,
      full_url: buildShortLinkUrl(shortCode),
      destination_url: destinationUrl,
      already_exists: false,
    };
  }

  static async getOrCreateUtmVariant(
    parentId: string,
    channelKey: string,
    createdBy?: string
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

    const utmDestination = assertAllowedShortLinkDestination(
      buildUtmUrl(parent.destination_url, channel, parent.name || parent.id)
    );
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
      .update({ parent_link_id: parentId, name: variantName, ...(createdBy ? { created_by: createdBy } : {}) })
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
      .maybeSingle();
    
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

  static async getLegacyDomainUsage(days: number = 90): Promise<LegacyDomainUsage> {
    const boundedDays = Math.min(Math.max(Math.floor(days), 1), 730);
    const generatedAt = new Date();
    const startAt = new Date(generatedAt.getTime() - boundedDays * 24 * 60 * 60 * 1000).toISOString();
    const { rows, trackingColumnReady } = await fetchLegacyUsageClickRows(startAt);

    let humanClicks = 0;
    let legacyClicks = 0;
    let legacyHumanClicks = 0;
    let canonicalClicks = 0;
    let canonicalHumanClicks = 0;
    let untrackedClicks = 0;
    let untrackedHumanClicks = 0;

    const topLegacyByLink = new Map<string, LegacyDomainLinkUsage>();
    const recentLegacyClicks: LegacyDomainRecentClick[] = [];

    for (const row of rows) {
      const human = isHumanClick(row);
      const requestHost = normalizeHost(row.request_host);
      const link = getRelatedShortLink(row);

      if (human) humanClicks += 1;

      if (!requestHost) {
        untrackedClicks += 1;
        if (human) untrackedHumanClicks += 1;
        continue;
      }

      if (isCanonicalShortLinkHost(requestHost)) {
        canonicalClicks += 1;
        if (human) canonicalHumanClicks += 1;
        continue;
      }

      if (!isLegacyShortLinkHost(requestHost)) {
        continue;
      }

      legacyClicks += 1;
      if (human) legacyHumanClicks += 1;

      const shortCode = link?.short_code || row.short_link_id || 'unknown';
      const destination = parseDestinationUrl(link?.destination_url ?? null);
      addClickToLinkUsage(topLegacyByLink, row, human);

      if (recentLegacyClicks.length < 25) {
        recentLegacyClicks.push({
          shortCode,
          name: link?.name ?? null,
          requestHost,
          clickedAt: row.clicked_at,
          destinationHost: destination.host,
          destinationPath: destination.path,
          deviceType: row.device_type,
        });
      }
    }

    const topLegacyLinks = sortLinkUsageRows(Array.from(topLegacyByLink.values())).slice(0, 25);

    return {
      generatedAt: generatedAt.toISOString(),
      startAt,
      days: boundedDays,
      trackingColumnReady,
      totalClicks: rows.length,
      humanClicks,
      legacyClicks,
      legacyHumanClicks,
      canonicalClicks,
      canonicalHumanClicks,
      untrackedClicks,
      untrackedHumanClicks,
      topLegacyLinks,
      recentLegacyClicks,
    };
  }
}
