import { NextRequest } from 'next/server';
import { z } from 'zod';

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { CHANNEL_MAP } from '@/lib/short-links/channels';
import { buildUtmUrl } from '@/lib/short-links/utm';
import { ShortLinkService } from '@/services/short-links';

const MetaAdsLinkSchema = z.object({
  destinationUrl: z.string().trim().url('destinationUrl must be a valid URL'),
  campaignName: z.string().trim().min(1, 'campaignName is required').max(120),
  metadata: z.record(z.any()).optional(),
});

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

    try {
      const link = await ShortLinkService.createShortLinkInternal({
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

      return createApiResponse({
        shortUrl: link.full_url,
        short_url: link.full_url,
        shortCode: link.short_code,
        short_code: link.short_code,
        destinationUrl: parsed.destinationUrl,
        destination_url: parsed.destinationUrl,
        utmDestinationUrl,
        utm_destination_url: utmDestinationUrl,
        alreadyExists: link.already_exists,
        already_exists: link.already_exists,
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
