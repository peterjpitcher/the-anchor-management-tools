import { NextRequest } from 'next/server';
import { z } from 'zod';

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { EventMarketingService } from '@/services/event-marketing';
import { ShortLinkService } from '@/services/short-links';

/**
 * Per-post short links for CheersAI's organic Facebook posts.
 *
 * Each post gets its own variant of the event's Facebook link: the same page and the same
 * utm_source, utm_medium, utm_campaign and utm_term, with the post's own utm_content. Clicks are
 * counted per link, and a booking made after a click carries the post's utm_content through the
 * website to CheersAI. The variants are labelled `facebook_post` and marked as variants, so the
 * event's own Facebook link is never replaced by one (see src/lib/short-links/variants.ts).
 */

const UtmContentSchema = z
  .string({ required_error: 'utmContent is required' })
  .trim()
  .min(1, 'utmContent is required')
  .max(100, 'utmContent must be 100 characters or fewer')
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'utmContent can only contain letters, numbers, underscores, and hyphens')
  .transform((value) => value.toLowerCase());

const ShortCodeSchema = z
  .string()
  .trim()
  .regex(/^\/?[a-z0-9-]+$/i, 'eventShortCode must be a valid short code')
  .transform((value) => value.replace(/^\//, '').toLowerCase());

const SocialPostLinksSchema = z.object({
  // Either the event id, or the code of one of the event's short links (CheersAI keeps the
  // event's Facebook link with each post, not the event id). Either way the variants hang off
  // the event's own Facebook link.
  eventId: z.string().trim().min(1).max(120).optional(),
  eventShortCode: ShortCodeSchema.optional(),
  posts: z
    .array(z.object({
      utmContent: UtmContentSchema,
      name: z.string().trim().max(160).optional(),
      metadata: z.record(z.any()).optional(),
    }), { required_error: 'posts is required' })
    .min(1, 'At least one post is required')
    .max(50, 'At most 50 posts per request'),
}).refine((body) => Boolean(body.eventId) !== Boolean(body.eventShortCode), {
  message: 'Give eventId or eventShortCode, not both',
});

export async function POST(_request: NextRequest) {
  return withApiAuth(async (request) => {
    let parsed: z.infer<typeof SocialPostLinksSchema>;
    try {
      parsed = SocialPostLinksSchema.parse(await request.json());
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.issues[0]?.message ?? 'Invalid request body'
        : 'Invalid request body';
      return createErrorResponse(message, 'VALIDATION_ERROR', 400);
    }

    let eventId = parsed.eventId ?? null;
    try {
      if (!eventId && parsed.eventShortCode) {
        eventId = await ShortLinkService.findEventIdForShortCode(parsed.eventShortCode);
        if (!eventId) {
          return createErrorResponse('That short link is not an event link', 'EVENT_LINK_NOT_FOUND', 404);
        }
      }
      // The event's own Facebook link, created if it does not exist yet.
      const eventLink = await EventMarketingService.generateSingleLink(eventId as string, 'facebook');
      const variants = await Promise.all(
        parsed.posts.map(async (post) => {
          const variant = await ShortLinkService.getOrCreateShortLinkVariantInternal({
            parent_short_code: eventLink.shortCode,
            destination_url: eventLink.destinationUrl,
            utm_content: post.utmContent,
            name: post.name,
            channel: 'facebook_post',
            metadata: {
              source: 'social_post_api',
              event_id: eventId,
              ...(post.metadata ?? {}),
            },
          });
          return {
            utmContent: post.utmContent,
            shortUrl: variant.full_url,
            shortCode: variant.short_code,
            destinationUrl: variant.destination_url,
            alreadyExists: variant.already_exists,
          };
        })
      );

      return createApiResponse({
        eventId,
        parentShortCode: eventLink.shortCode,
        parentShortUrl: eventLink.shortUrl,
        variants,
      }, 200, undefined, 'POST');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create social post links';
      return createErrorResponse(message, 'SHORT_LINK_CREATE_FAILED', 500);
    }
  }, ['read:events', 'read:menu'], _request);
}

export async function OPTIONS() {
  return createApiResponse({}, 200);
}
