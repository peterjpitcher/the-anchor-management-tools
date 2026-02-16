import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency';
import { formatPhoneForStorage } from '@/lib/utils';
import { PrivateBookingService } from '@/services/private-bookings';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ExternalBookingSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(5).max(32),
  partySize: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(500)
  ).optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  notes: z.string().trim().max(2000).optional(),
  extras: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  perks: z.array(z.string().trim().min(1).max(120)).max(20).optional()
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (req) => {
    try {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
      }

      const parsed = ExternalBookingSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: parsed.error.issues[0]?.message || 'Invalid booking payload' },
          { status: 400 }
        );
      }

      const payload = parsed.data;
      let normalizedPhone: string;
      try {
        normalizedPhone = formatPhoneForStorage(payload.phone);
      } catch {
        return NextResponse.json({ success: false, error: 'Please enter a valid phone number' }, { status: 400 });
      }

      const normalizedEmail = payload.email?.trim().toLowerCase() || undefined;
      const requestHash = computeIdempotencyRequestHash({
        name: payload.name,
        email: normalizedEmail || null,
        phone: normalizedPhone,
        partySize: payload.partySize ?? null,
        preferredDate: payload.preferredDate ?? null,
        preferredTime: payload.preferredTime ?? null,
        notes: payload.notes ?? null,
        extras: payload.extras ?? [],
        perks: payload.perks ?? []
      });
      const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
      const idempotencyKey = getIdempotencyKey(req)
        || `external_create_booking:${requestHash.slice(0, 32)}:${hourBucket}`;

      const supabase = createAdminClient();
      const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash);

      if (claim.state === 'conflict') {
        return NextResponse.json(
          {
            success: false,
            error: 'Idempotency key already used with a different request payload'
          },
          { status: 409 }
        );
      }

      if (claim.state === 'replay') {
        return NextResponse.json(claim.response, { status: 201 });
      }

      if (claim.state === 'in_progress') {
        return NextResponse.json(
          {
            success: false,
            error: 'This request is already being processed. Please retry shortly.'
          },
          { status: 409 }
        );
      }

      let claimHeld = true;
      let createdBookingId: string | null = null;
      try {
        const nameParts = payload.name
        .trim()
        .split(/\s+/)
        .filter(Boolean);
        const firstName = nameParts[0] ?? 'Unknown';
        const lastName =
          nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        const noteSections: string[] = [];
        if (payload.notes?.trim()) {
          noteSections.push(payload.notes.trim());
        }
        if (payload.extras?.length) {
          noteSections.push(`Requested Extras: ${payload.extras.join(', ')}`);
        }
        if (payload.perks?.length) {
          noteSections.push(`Offers Claimed: ${payload.perks.join(', ')}`);
        }
        noteSections.push('[Created via Website Christmas Form]');

        const input = {
          customer_first_name: firstName,
          customer_last_name: lastName,
          contact_email: normalizedEmail,
          contact_phone: normalizedPhone,
          event_date: payload.preferredDate,
          start_time: payload.preferredTime,
          guest_count: payload.partySize,
          event_type: 'Christmas Party',
          source: 'website',
          status: 'draft',
          internal_notes: noteSections.join('\n\n'),
          date_tbd: false,
        };

        const booking = await PrivateBookingService.createBooking(input);
        createdBookingId = typeof booking?.id === 'string' ? booking.id : null;
        const responsePayload = {
          success: true,
          id: booking.id,
          reference: (booking as any)?.booking_reference || booking.id
        };
        try {
          await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload);
          claimHeld = false;
        } catch (persistError) {
          // Booking was created, but we could not persist the idempotency response.
          // Fail closed by leaving the idempotency claim in place so retries cannot
          // create duplicate bookings.
          logger.error('Failed to persist external create-booking idempotency response', {
            error: persistError instanceof Error ? persistError : new Error(String(persistError)),
            metadata: {
              bookingId: createdBookingId,
              idempotencyKey,
              requestHash,
            },
          });
        }

        return NextResponse.json(responsePayload, { status: 201 });
      } finally {
        if (claimHeld && !createdBookingId) {
          try {
            await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash);
          } catch (releaseError) {
            logger.error('Failed to release external create-booking idempotency claim', {
              error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
              metadata: {
                idempotencyKey,
                requestHash,
              },
            });
          }
        }
      }

    } catch (error) {
      logger.error('External booking creation failed', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create booking' },
        { status: 500 }
      );
    }
  }, ['create:bookings'], request);
}
