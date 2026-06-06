import { NextRequest } from 'next/server';
import { z } from 'zod';

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
import { CHANNEL_MAP } from '@/lib/short-links/channels';
import { buildUtmUrl } from '@/lib/short-links/utm';
import { EventMarketingService } from '@/services/event-marketing';
import { ShortLinkService } from '@/services/short-links';

const ShortCodeSchema = z
  .string()
  .trim()
  .regex(/^\/?[a-z0-9-]+$/i, 'parentShortCode must be a valid short code');

const UtmContentSchema = z
  .string()
  .trim()
  .min(1, 'utmContent is required')
  .max(160, 'utmContent must be 160 characters or fewer')
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'utmContent can only contain letters, numbers, underscores, and hyphens')
  .transform((value) => value.toLowerCase());

const MetaAdsVariantSchema = z.object({
  utmContent: UtmContentSchema,
  name: z.string().trim().max(160).optional(),
  metadata: z.record(z.any()).optional(),
});

const MetaAdsLinkSchema = z.object({
  destinationUrl: z.string().trim().url('destinationUrl must be a valid URL'),
  campaignName: z.string().trim().min(1, 'campaignName is required').max(120),
  eventId: z.string().trim().min(1).max(120).optional(),
  parentShortCode: ShortCodeSchema.optional(),
  variants: z.array(MetaAdsVariantSchema).max(50).optional(),
  metadata: z.record(z.any()).optional(),
});

function normalizeShortCode(value: string): string {
  return value.trim().replace(/^\//, '').toLowerCase();
}

export async function POST(_request: NextRequest) {
  return withApiAuth(async (request) => {
    let parsed: z.infer<typeof MetaAdsLinkSchema>;

    try {
      parsed = MetaAdsLinkSchema.parse(await request.json());
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.issues[0]?.message ?? 'Invalid request body'
        : 'Invalid request body';
      return createErrorResponse(message, 'VALIDATION_ERROR', 400);
    }

    const channel = CHANNEL_MAP.get('meta_ads');
    if (!channel) {
      return createErrorResponse('Meta Ads channel is not configured', 'CHANNEL_NOT_CONFIGURED', 500);
    }

    const utmDestinationUrl = buildUtmUrl(parsed.destinationUrl, channel, parsed.campaignName);
    const variants = parsed.variants ?? [];

    try {
      let link: {
        short_code: string;
        full_url: string;
        already_exists: boolean;
        destination_url: string;
      };
      let parentUtmDestinationUrl = utmDestinationUrl;

      if (parsed.parentShortCode) {
        link = {
          short_code: normalizeShortCode(parsed.parentShortCode),
          full_url: buildShortLinkUrl(normalizeShortCode(parsed.parentShortCode)),
          already_exists: true,
          destination_url: parsed.destinationUrl,
        };
        parentUtmDestinationUrl = parsed.destinationUrl;
      } else if (parsed.eventId) {
        const eventLink = await EventMarketingService.generateSingleLink(parsed.eventId, 'meta_ads');
        link = {
          short_code: eventLink.shortCode,
          full_url: eventLink.shortUrl,
          already_exists: true,
          destination_url: eventLink.destinationUrl,
        };
        parentUtmDestinationUrl = eventLink.destinationUrl;
      } else {
        const createdLink = await ShortLinkService.createShortLinkInternal({
          destination_url: utmDestinationUrl,
          link_type: 'custom',
          metadata: {
            channel: 'meta_ads',
            source: 'paid_media_api',
            campaign_name: parsed.campaignName,
            destination_url: parsed.destinationUrl,
            utm_destination_url: utmDestinationUrl,
            ...(parsed.metadata ?? {}),
          },
        });

        link = {
          ...createdLink,
          destination_url: utmDestinationUrl,
        };
      }

      const variantLinks = await Promise.all(
        variants.map(async (variant) => {
          const variantLink = await ShortLinkService.getOrCreateShortLinkVariantInternal({
            parent_short_code: link.short_code,
            destination_url: parentUtmDestinationUrl,
            utm_content: variant.utmContent,
            name: variant.name,
            metadata: {
              source: 'paid_media_api',
              campaign_name: parsed.campaignName,
              destination_url: parsed.destinationUrl,
              parent_utm_destination_url: parentUtmDestinationUrl,
              ...(parsed.eventId ? { event_id: parsed.eventId } : {}),
              ...(parsed.metadata ?? {}),
              ...(variant.metadata ?? {}),
            },
          });

          return {
            shortUrl: variantLink.full_url,
            short_url: variantLink.full_url,
            shortCode: variantLink.short_code,
            short_code: variantLink.short_code,
            destinationUrl: parsed.destinationUrl,
            destination_url: parsed.destinationUrl,
            utmDestinationUrl: variantLink.destination_url,
            utm_destination_url: variantLink.destination_url,
            utmContent: variant.utmContent,
            utm_content: variant.utmContent,
            parentShortCode: link.short_code,
            parent_short_code: link.short_code,
            alreadyExists: variantLink.already_exists,
            already_exists: variantLink.already_exists,
          };
        })
      );

      return createApiResponse({
        shortUrl: link.full_url,
        short_url: link.full_url,
        shortCode: link.short_code,
        short_code: link.short_code,
        destinationUrl: parsed.destinationUrl,
        destination_url: parsed.destinationUrl,
        utmDestinationUrl: parentUtmDestinationUrl,
        utm_destination_url: parentUtmDestinationUrl,
        alreadyExists: link.already_exists,
        already_exists: link.already_exists,
        variants: variantLinks,
      }, 200, undefined, 'POST');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Meta Ads short link';
      return createErrorResponse(message, 'SHORT_LINK_CREATE_FAILED', 500);
    }
  }, ['read:events', 'read:menu'], _request);
}

export async function OPTIONS() {
  return createApiResponse({}, 200);
}
