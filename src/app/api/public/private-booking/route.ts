import { NextRequest, NextResponse } from 'next/server';
import { PrivateBookingService, type CreatePrivateBookingInput } from '@/services/private-bookings';
import type { BookingItemFormData } from '@/types/private-bookings';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { formatPhoneForStorage } from '@/lib/utils';
import {
    claimIdempotencyKey,
    computeIdempotencyRequestHash,
    getIdempotencyKey,
    persistIdempotencyResponse,
    releaseIdempotencyClaim
} from '@/lib/api/idempotency';
import { createRateLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Schema for public booking requests
// Simplified version of the internal types but stricter validation could be added here
interface PublicBookingRequest extends CreatePrivateBookingInput {
    items?: BookingItemFormData[];
    default_country_code?: string;
}

const DEPRECATION_HEADERS = {
    Deprecation: 'true',
    Sunset: 'Wed, 30 Sep 2026 00:00:00 GMT',
    Link: '</api/private-booking-enquiry>; rel="successor-version"'
} as const;

const privateBookingPublicLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: 'Too many private booking requests. Please try again shortly.'
});

async function recordPublicPrivateBookingAnalyticsSafe(
    supabase: ReturnType<typeof createAdminClient>,
    payload: Parameters<typeof recordAnalyticsEvent>[1],
    context: Record<string, unknown>
): Promise<void> {
    try {
        await recordAnalyticsEvent(supabase, payload);
    } catch (analyticsError) {
        logger.warn('Failed to record public private-booking analytics event', {
            metadata: {
                ...context,
                error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
            }
        });
    }
}

/**
 * Public endpoint to create a private booking.
 * Accepts booking details and items, creates a draft booking.
 */
export async function POST(request: NextRequest) {
    try {
        const rateLimitResponse = await privateBookingPublicLimiter(request);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        let body: any;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { success: false, error: 'Invalid JSON body' },
                { status: 400 }
            );
        }
        const supabase = createAdminClient();
        const idempotencyKey = getIdempotencyKey(request);

        if (!idempotencyKey) {
            return NextResponse.json(
                { success: false, error: 'Missing Idempotency-Key header' },
                { status: 400 }
            );
        }

        if (
            body.default_country_code !== undefined &&
            (typeof body.default_country_code !== 'string' || !/^\d{1,4}$/.test(body.default_country_code))
        ) {
            return NextResponse.json(
                { success: false, error: 'default_country_code must be 1 to 4 digits' },
                { status: 400 }
            );
        }

        let normalizedPhone: string | undefined;
        if (typeof body.contact_phone === 'string' && body.contact_phone.trim().length > 0) {
            try {
                normalizedPhone = formatPhoneForStorage(body.contact_phone, {
                    defaultCountryCode:
                        typeof body.default_country_code === 'string'
                            ? body.default_country_code
                            : undefined
                });
            } catch {
                return NextResponse.json(
                    { success: false, error: 'Please enter a valid phone number' },
                    { status: 400 }
                );
            }
        }

        const requestHash = computeIdempotencyRequestHash({
            ...body,
            contact_phone: normalizedPhone || body.contact_phone || null
        });
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
            return NextResponse.json(claim.response, {
                status: 201,
                headers: DEPRECATION_HEADERS
            });
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
            // Basic validation
            if (!body.customer_first_name || !(normalizedPhone || body.contact_phone)) {
                return NextResponse.json(
                    { success: false, error: 'Missing required fields' },
                    { status: 400 }
                );
            }

            // Ensure status is forced to draft and source is website
            const bodyWithoutCountryCode = { ...(body as PublicBookingRequest) };
            delete bodyWithoutCountryCode.default_country_code;
            const bookingPayload: CreatePrivateBookingInput = {
                ...bodyWithoutCountryCode,
                contact_phone: normalizedPhone || body.contact_phone,
                status: 'draft',
                source: 'website',
                // Ensure items are properly typed even if passed from frontend
                items: body.items
            };

            const booking = await PrivateBookingService.createBooking(bookingPayload);
            createdBookingId = typeof booking?.id === 'string' ? booking.id : null;

            if ((booking as any)?.customer_id) {
                await recordPublicPrivateBookingAnalyticsSafe(supabase, {
                    customerId: (booking as any).customer_id,
                    privateBookingId: (booking as any).id,
                    eventType: 'private_booking_enquiry_created',
                    metadata: {
                        source: 'brand_site'
                    }
                }, {
                    privateBookingId: (booking as any).id,
                    customerId: (booking as any).customer_id
                });
            }

            const responsePayload = {
                success: true,
                state: 'enquiry_created',
                booking_id: booking.id,
                reference: booking.booking_reference || booking.id,
                data: {
                    id: booking.id,
                    reference: booking.booking_reference // If available, otherwise just ID
                }
            };

            try {
                await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload);
                claimHeld = false;
            } catch (persistError) {
                // Booking was created, but we could not persist the idempotency response.
                // Fail closed by leaving the idempotency claim in place so a client retry
                // cannot create a duplicate booking.
                logger.error('Failed to persist public private-booking idempotency response', {
                    error: persistError instanceof Error ? persistError : new Error(String(persistError)),
                    metadata: {
                        bookingId: createdBookingId,
                        idempotencyKey,
                        requestHash
                    }
                });
            }

            return NextResponse.json(responsePayload, {
                status: 201,
                headers: DEPRECATION_HEADERS
            });
        } finally {
            if (claimHeld && !createdBookingId) {
                try {
                    await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash);
                } catch (releaseError) {
                    logger.error('Failed to release public private-booking idempotency claim', {
                        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
                        metadata: {
                            idempotencyKey,
                            requestHash
                        }
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Error creating public private booking', {
            error: error instanceof Error ? error : new Error(String(error))
        });
        return NextResponse.json(
            { success: false, error: 'Failed to create booking' },
            { status: 500 }
        );
    }
}
