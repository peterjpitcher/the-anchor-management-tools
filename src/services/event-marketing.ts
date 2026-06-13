import { createAdminClient } from '@/lib/supabase/admin';
import {
  EVENT_MARKETING_CHANNELS,
  EVENT_MARKETING_CHANNEL_MAP,
  buildEventMarketingLinkPayload,
  buildShortCode,
  isEventMarketingQrChannel,
  shouldAutoGenerateEventMarketingChannel,
  type EventMarketingChannelKey,
  type EventMarketingChannelType,
  type EventMarketingLinkPayload,
} from '@/lib/event-marketing-links';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
import QRCode from 'qrcode';

export interface EventMarketingLink {
  id: string;
  channel: EventMarketingChannelKey;
  label: string;
  type: EventMarketingChannelType;
  shortCode: string;
  shortUrl: string;
  destinationUrl: string;
  utm: Record<string, string>;
  description?: string;
  qrCode?: string;
  updatedAt?: string;
  clickCount: number;
  lastClickedAt?: string;
}

export interface EventMarketingMessage {
  id: string;
  messageId: string | null;
  customerId: string | null;
  customerName: string | null;
  recipientPhone: string | null;
  templateKey: string;
  body: string | null;
  status: string;
  sentAt: string;
  createdAt: string;
}

interface ExistingShortLink {
  id: string;
  short_code: string;
  destination_url: string;
  metadata: any;
  updated_at: string | null;
}

type PromoContextRow = {
  id: string;
  customer_id: string;
  phone_number: string;
  event_id: string;
  template_key: string;
  message_id: string | null;
  created_at: string | null;
};

type SmsMessageRow = {
  id: string;
  customer_id: string;
  body: string;
  status: string;
  twilio_status: string | null;
  sent_at: string | null;
  created_at: string;
  to_number: string | null;
  template_key: string | null;
  message_sid: string | null;
  metadata?: unknown;
};

type CustomerSummaryRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  mobile_number: string | null;
  mobile_e164: string | null;
};

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

function clampMessageLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getCustomerName(customer: CustomerSummaryRow | undefined): string | null {
  if (!customer) return null;
  const name = [customer.first_name, customer.last_name]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(' ');
  return name || null;
}

function getMessageTemplateKey(message: SmsMessageRow, fallback?: string | null): string {
  if (isNonEmptyString(message.template_key)) {
    return message.template_key;
  }

  const metadata = asRecord(message.metadata);
  const metadataTemplateKey = metadata?.template_key;
  return isNonEmptyString(metadataTemplateKey) ? metadataTemplateKey : fallback || 'marketing_sms';
}

function isMarketingMetadataMessage(message: SmsMessageRow): boolean {
  const metadata = asRecord(message.metadata);
  const templateKey = getMessageTemplateKey(message);

  return (
    metadata?.marketing === true ||
    metadata?.bulk_sms === true ||
    templateKey === 'bulk_sms_campaign' ||
    templateKey.startsWith('event_cross_promo_') ||
    templateKey.startsWith('event_general_promo_') ||
    templateKey.startsWith('event_reminder_promo_')
  );
}

const UNLINKED_CONTEXT_MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;
const UNLINKED_CONTEXT_EARLY_TOLERANCE_MS = 5 * 60 * 1000;

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhoneForComparison(value: string | null | undefined): string | null {
  if (!isNonEmptyString(value)) return null;
  return value.replace(/[^\d+]/g, '');
}

function phoneDigits(value: string | null | undefined): string | null {
  if (!isNonEmptyString(value)) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function phoneNumbersMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizePhoneForComparison(left);
  const normalizedRight = normalizePhoneForComparison(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftDigits = phoneDigits(left);
  const rightDigits = phoneDigits(right);
  if (!leftDigits || !rightDigits || leftDigits.length < 10 || rightDigits.length < 10) return false;

  return leftDigits.slice(-10) === rightDigits.slice(-10);
}

function findMatchingUnlinkedMessage(
  context: PromoContextRow,
  candidates: SmsMessageRow[],
  usedMessageIds: Set<string>
): SmsMessageRow | undefined {
  const contextAt = timestampMs(context.created_at);
  if (!contextAt) return undefined;

  let bestMatch: SmsMessageRow | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const message of candidates) {
    if (usedMessageIds.has(message.id)) continue;
    if (message.customer_id !== context.customer_id) continue;
    if (getMessageTemplateKey(message) !== context.template_key) continue;
    if (!phoneNumbersMatch(message.to_number, context.phone_number)) continue;

    const messageAt = timestampMs(message.sent_at || message.created_at);
    if (!messageAt) continue;

    const delta = messageAt - contextAt;
    if (delta < -UNLINKED_CONTEXT_EARLY_TOLERANCE_MS || delta > UNLINKED_CONTEXT_MATCH_WINDOW_MS) {
      continue;
    }

    if (delta < bestDelta) {
      bestDelta = delta;
      bestMatch = message;
    }
  }

  return bestMatch;
}

function toMarketingMessage(params: {
  context?: PromoContextRow;
  message?: SmsMessageRow;
  customer?: CustomerSummaryRow;
}): EventMarketingMessage {
  const { context, message, customer } = params;
  const templateKey = message ? getMessageTemplateKey(message, context?.template_key) : context?.template_key || 'marketing_sms';
  const sentAt = message?.sent_at || context?.created_at || message?.created_at || new Date(0).toISOString();
  const createdAt = context?.created_at || message?.created_at || sentAt;

  return {
    id: context?.id || message?.id || `${templateKey}:${sentAt}`,
    messageId: message?.id || context?.message_id || null,
    customerId: context?.customer_id || message?.customer_id || null,
    customerName: getCustomerName(customer),
    recipientPhone: message?.to_number || context?.phone_number || customer?.mobile_e164 || customer?.mobile_number || null,
    templateKey,
    body: message?.body || null,
    status: message?.twilio_status || message?.status || 'sent',
    sentAt,
    createdAt,
  };
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
      if (error.code === '23505') {
        continue;
      }
      throw error;
    }

    return data as ExistingShortLink;
  }

  throw new Error(`Failed to create short link for channel ${payload.channel}`);
}

export class EventMarketingService {
  static async getSentMessages(eventId: string, limit = 50): Promise<EventMarketingMessage[]> {
    const supabase = createAdminClient();
    const safeLimit = clampMessageLimit(limit);

    const { data: contexts, error: contextsError } = await supabase
      .from('sms_promo_context')
      .select('id, customer_id, phone_number, event_id, template_key, message_id, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (contextsError) {
      throw new Error('Failed to load sent marketing messages');
    }

    const contextRows = (contexts || []) as PromoContextRow[];
    const messageIds = Array.from(new Set(contextRows.map(row => row.message_id).filter(isNonEmptyString)));
    const messagesById = new Map<string, SmsMessageRow>();
    const unlinkedMessagesByContextId = new Map<string, SmsMessageRow>();

    if (messageIds.length > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('id, customer_id, body, status, twilio_status, sent_at, created_at, to_number, template_key, message_sid')
        .in('id', messageIds);

      if (messagesError) {
        console.warn('Failed to load sent marketing message bodies', messagesError);
      } else {
        for (const message of (messages || []) as SmsMessageRow[]) {
          messagesById.set(message.id, message);
        }
      }
    }

    const unlinkedContexts = contextRows.filter(context => !isNonEmptyString(context.message_id));
    if (unlinkedContexts.length > 0) {
      const customerIdsForUnlinked = Array.from(new Set(unlinkedContexts.map(row => row.customer_id).filter(isNonEmptyString)));
      const templateKeysForUnlinked = Array.from(new Set(unlinkedContexts.map(row => row.template_key).filter(isNonEmptyString)));

      if (customerIdsForUnlinked.length > 0 && templateKeysForUnlinked.length > 0) {
        const { data: candidateMessages, error: candidateMessagesError } = await supabase
          .from('messages')
          .select('id, customer_id, body, status, twilio_status, sent_at, created_at, to_number, template_key, message_sid')
          .eq('direction', 'outbound')
          .in('customer_id', customerIdsForUnlinked)
          .in('template_key', templateKeysForUnlinked)
          .order('sent_at', { ascending: false })
          .limit(Math.min(200, safeLimit * 4));

        if (candidateMessagesError) {
          console.warn('Failed to load fallback sent marketing message bodies', candidateMessagesError);
        } else {
          const usedRecoveredMessageIds = new Set<string>();
          const candidates = (candidateMessages || []) as SmsMessageRow[];
          for (const context of unlinkedContexts) {
            const message = findMatchingUnlinkedMessage(context, candidates, usedRecoveredMessageIds);
            if (message?.id) {
              usedRecoveredMessageIds.add(message.id);
              unlinkedMessagesByContextId.set(context.id, message);
            }
          }
        }
      }
    }

    // Newer deployments may have a messages.metadata JSON column, which lets manual
    // bulk campaigns selected for an event show up alongside automated promo sends.
    const metadataMessages: SmsMessageRow[] = [];
    try {
      const { data, error } = await (supabase.from('messages') as any)
        .select('id, customer_id, body, status, twilio_status, sent_at, created_at, to_number, template_key, message_sid, metadata')
        .eq('direction', 'outbound')
        .contains('metadata', { event_id: eventId })
        .order('sent_at', { ascending: false })
        .limit(safeLimit);

      if (error) {
        const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
        if (!message.includes('metadata')) {
          console.warn('Failed to load metadata-tagged event marketing messages', error);
        }
      } else {
        metadataMessages.push(...((data || []) as SmsMessageRow[]).filter(isMarketingMetadataMessage));
      }
    } catch {
      // The metadata column is optional in older schemas.
    }

    const partialMessages: Array<{ context?: PromoContextRow; message?: SmsMessageRow }> = [];
    const seenMessageIds = new Set<string>();

    for (const context of contextRows) {
      const message = context.message_id ? messagesById.get(context.message_id) : unlinkedMessagesByContextId.get(context.id);
      if (message?.id) {
        seenMessageIds.add(message.id);
      }
      partialMessages.push({ context, message });
    }

    for (const message of metadataMessages) {
      if (seenMessageIds.has(message.id)) continue;
      seenMessageIds.add(message.id);
      partialMessages.push({ message });
    }

    const customerIds = Array.from(new Set(
      partialMessages
        .map(item => item.context?.customer_id || item.message?.customer_id)
        .filter(isNonEmptyString)
    ));
    const customersById = new Map<string, CustomerSummaryRow>();

    if (customerIds.length > 0) {
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, first_name, last_name, mobile_number, mobile_e164')
        .in('id', customerIds);

      if (customersError) {
        console.warn('Failed to load sent marketing message recipients', customersError);
      } else {
        for (const customer of (customers || []) as CustomerSummaryRow[]) {
          customersById.set(customer.id, customer);
        }
      }
    }

    return partialMessages
      .map(item => toMarketingMessage({
        ...item,
        customer: customersById.get(item.context?.customer_id || item.message?.customer_id || ''),
      }))
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, safeLimit);
  }

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

    for (const channel of EVENT_MARKETING_CHANNELS.filter(shouldAutoGenerateEventMarketingChannel)) {
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
          .maybeSingle();

        if (updateError) {
          console.error('Failed to update marketing link', channel.key, updateError);
        } else if (updated) {
          existingByChannel.set(channel.key, updated as ExistingShortLink);
        } else {
          try {
            const inserted = await insertShortLinkWithRetries(event, payload, metadata);
            existingByChannel.set(channel.key, inserted);
          } catch (insertError) {
            console.error('Failed to recreate marketing link after stale update', channel.key, insertError);
          }
        }
      }
    }

    return await this.getLinks(eventId);
  }

  static async getLinks(eventId: string): Promise<EventMarketingLink[]> {
    const supabase = createAdminClient();

    const { data: links, error } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, metadata, updated_at, click_count, last_clicked_at')
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

        const shortUrl = buildShortLinkUrl(link.short_code);

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
          clickCount: (link as Record<string, unknown>).click_count as number ?? 0,
          lastClickedAt: (link as Record<string, unknown>).last_clicked_at as string ?? undefined,
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
        const channelConfig = EVENT_MARKETING_CHANNEL_MAP.get(item.channel);
        if (channelConfig && isEventMarketingQrChannel(channelConfig)) {
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

  static async generateSingleLink(
    eventId: string,
    channel: EventMarketingChannelKey
  ): Promise<EventMarketingLink> {
    const channelConfig = EVENT_MARKETING_CHANNEL_MAP.get(channel);
    if (!channelConfig) {
      throw new Error(`Unknown channel: ${channel}`);
    }

    const supabase = createAdminClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, slug, name, date')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Event not found for marketing link generation');
    }

    if (!event.slug) {
      throw new Error('Event is missing a slug for marketing link generation');
    }

    const payload = buildEventMarketingLinkPayload(event, channelConfig);
    const metadata = buildMetadata(payload, event);

    // Check if a link for this event+channel already exists to avoid duplicates
    const { data: existingLinks, error: fetchError } = await supabase
      .from('short_links')
      .select('id, short_code, destination_url, metadata, updated_at')
      .contains('metadata', { event_id: event.id, channel });

    if (fetchError) {
      throw new Error('Failed to check for existing marketing link');
    }

    const existing = (existingLinks && existingLinks.length > 0)
      ? existingLinks[0] as ExistingShortLink
      : null;

    const record = existing ?? await insertShortLinkWithRetries(event, payload, metadata);
    const shortUrl = buildShortLinkUrl(record.short_code);

    const link: EventMarketingLink = {
      id: record.id,
      channel: channelConfig.key,
      label: channelConfig.label,
      type: channelConfig.type,
      description: channelConfig.description,
      shortCode: record.short_code,
      shortUrl,
      destinationUrl: record.destination_url,
      utm: record.metadata?.utm || {},
      updatedAt: record.updated_at || undefined,
      clickCount: 0,
    };

    if (isEventMarketingQrChannel(channelConfig)) {
      try {
        link.qrCode = await QRCode.toDataURL(shortUrl, { margin: 1, scale: 8 });
      } catch (err) {
        console.error('Failed to generate QR for single link', channel, err);
      }
    }

    return link;
  }
}
