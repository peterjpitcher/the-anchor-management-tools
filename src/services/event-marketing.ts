import { createAdminClient } from '@/lib/supabase/admin';
import { EVENT_MARKETING_CHANNELS, EVENT_MARKETING_CHANNEL_MAP, buildEventMarketingLinkPayload, buildShortCode, type EventMarketingChannelKey, type EventMarketingLinkPayload } from '@/lib/event-marketing-links';
import QRCode from 'qrcode';

const SHORT_LINK_BASE_URL = process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://vip-club.uk';

export interface EventMarketingLink {
  id: string;
  channel: EventMarketingChannelKey;
  label: string;
  type: 'digital' | 'print';
  shortCode: string;
  shortUrl: string;
  destinationUrl: string;
  utm: Record<string, string>;
  description?: string;
  qrCode?: string;
  updatedAt?: string;
}

interface ExistingShortLink {
  id: string;
  short_code: string;
  destination_url: string;
  metadata: any;
  updated_at: string | null;
}

interface EventRecord {
  id: string;
  slug: string;
  name: string;
  date: string;
}

function buildMetadata(payload: EventMarketingLinkPayload, event: EventRecord) {
  return {
    event_id: event.id,
    channel: payload.channel,
    label: payload.label,
    marketing_type: payload.type,
    utm: payload.utm,
    event_slug: event.slug,
    event_name: event.name,
    generated_at: new Date().toISOString()
  };
}

function buildShortUrl(shortCode: string): string {
  return `${SHORT_LINK_BASE_URL.replace(/\/$/, '')}/${shortCode}`;
}

function needsUpdate(existing: ExistingShortLink, payload: EventMarketingLinkPayload, metadata: any): boolean {
  if (!existing) return true;
  if (existing.destination_url !== payload.destinationUrl) return true;
  const existingMetadata = existing.metadata || {};
  if (existingMetadata.event_id !== metadata.event_id) return true;
  if (existingMetadata.channel !== metadata.channel) return true;
  const existingUtm = existingMetadata.utm || {};
  for (const [key, value] of Object.entries(metadata.utm || {})) {
    if (existingUtm[key] !== value) {
      return true;
    }
  }
  return false;
}

async function insertShortLinkWithRetries(event: EventRecord, payload: EventMarketingLinkPayload, metadata: any, maxAttempts = 3) {
  const supabase = createAdminClient();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shortCode = attempt === 0 ? payload.shortCode : buildShortCode(payload.shortCodePrefix, event.id, attempt);

    const { data, error } = await supabase
      .from('short_links')
      .insert({
        short_code: shortCode,
        destination_url: payload.destinationUrl,
        link_type: 'promotion',
        metadata,
        name: `Event: ${event.name} – ${payload.label}`
      })
      .select('id, short_code, destination_url, metadata, updated_at')
      .single();

    if (error) {
      if ((error as any).code === '23505') {
        continue;
      }
      throw error;
    }

    return data as ExistingShortLink;
  }

  throw new Error(`Failed to create short link for channel ${payload.channel}`);
}

export class EventMarketingService {
  static async generateLinks(eventId: string): Promise<EventMarketingLink[]> {
    const supabase = createAdminClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, slug, name, date')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Event not found for marketing links');
    }

    if (!event.slug) {
      throw new Error('Event is missing a slug for marketing links');
    }

    const { data: existingLinks, error: fetchError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, metadata, updated_at')
      .contains('metadata', { event_id: event.id });

    if (fetchError) {
      throw new Error('Failed to load existing marketing links');
    }

    const existingByChannel = new Map<EventMarketingChannelKey, ExistingShortLink>();
    for (const link of existingLinks || []) {
      const channelKey = link.metadata?.channel as EventMarketingChannelKey | undefined;
      if (channelKey) {
        existingByChannel.set(channelKey, link as ExistingShortLink);
      }
    }

    for (const channel of EVENT_MARKETING_CHANNELS) {
      const payload = buildEventMarketingLinkPayload(event, channel);
      const metadata = buildMetadata(payload, event);
      const existing = existingByChannel.get(channel.key);

      if (!existing) {
        try {
          const inserted = await insertShortLinkWithRetries(event, payload, metadata);
          existingByChannel.set(channel.key, inserted);
        } catch (error) {
          console.error('Failed to create short link for channel', channel.key, error);
        }
        continue;
      }

      if (needsUpdate(existing, payload, metadata)) {
        const { error: updateError, data: updated } = await supabase
          .from('short_links')
          .update({
            destination_url: payload.destinationUrl,
            metadata,
            name: `Event: ${event.name} – ${payload.label}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select('id, short_code, destination_url, metadata, updated_at')
          .single();

        if (updateError) {
          console.error('Failed to update marketing link', channel.key, updateError);
        } else if (updated) {
          existingByChannel.set(channel.key, updated as ExistingShortLink);
        }
      }
    }

    return await this.getLinks(eventId);
  }

  static async getLinks(eventId: string): Promise<EventMarketingLink[]> {
    const supabase = createAdminClient();

    const { data: links, error } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, metadata, updated_at')
      .contains('metadata', { event_id: eventId });

    if (error) {
      throw new Error('Failed to load marketing links');
    }

    const items = links
      ?.map((link) => {
        const channelKey = link.metadata?.channel as EventMarketingChannelKey | undefined;
        if (!channelKey) return null;
        const channel = EVENT_MARKETING_CHANNEL_MAP.get(channelKey);
        if (!channel) return null;

        const shortUrl = buildShortUrl(link.short_code);

        return {
          id: link.id,
          channel: channelKey,
          label: channel.label,
          type: channel.type,
          description: channel.description,
          shortCode: link.short_code,
          shortUrl,
          destinationUrl: link.destination_url,
          utm: link.metadata?.utm || {},
          updatedAt: link.updated_at || undefined,
        } satisfies EventMarketingLink;
      })
      .filter(Boolean) as EventMarketingLink[];

    items.sort((a, b) => {
      const orderA = EVENT_MARKETING_CHANNELS.findIndex((channel) => channel.key === a.channel);
      const orderB = EVENT_MARKETING_CHANNELS.findIndex((channel) => channel.key === b.channel);
      return orderA - orderB;
    });

    const withQRCodes = await Promise.all(
      items.map(async (item) => {
        if (item.type === 'print') {
          try {
            const qrCode = await QRCode.toDataURL(item.shortUrl, {
              margin: 1,
              scale: 8,
            });
            return { ...item, qrCode };
          } catch (error) {
            console.error('Failed to generate QR for marketing link', item.channel, error);
            return item;
          }
        }
        return item;
      })
    );

    return withQRCodes;
  }
}
