import { NextResponse } from 'next/server';
import { PrivateBookingService, type CreatePrivateBookingInput } from '@/services/private-bookings';
import type { BookingItemFormData } from '@/types/private-bookings';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { formatPhoneForStorage } from '@/lib/utils';
import {
    computeIdempotencyRequestHash,
    getIdempotencyKey,
    lookupIdempotencyKey,
    persistIdempotencyResponse
} from '@/lib/api/idempotency';

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

/**
 * Public endpoint to create a private booking.
 * Accepts booking details and items, creates a draft booking.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
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
        const lookup = await lookupIdempotencyKey(supabase, idempotencyKey, requestHash);

        if (lookup.state === 'conflict') {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Idempotency key already used with a different request payload'
                },
                { status: 409 }
            );
        }

        if (lookup.state === 'replay') {
            return NextResponse.json(lookup.response, {
                status: 201,
                headers: DEPRECATION_HEADERS
            });
        }

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

        if ((booking as any)?.customer_id) {
            await recordAnalyticsEvent(supabase, {
                customerId: (booking as any).customer_id,
                privateBookingId: (booking as any).id,
                eventType: 'private_booking_enquiry_created',
                metadata: {
                    source: 'brand_site'
                }
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

        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload);

        return NextResponse.json(responsePayload, {
            status: 201,
            headers: DEPRECATION_HEADERS
        });
    } catch (error) {
        console.error('Error creating private booking:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create booking' },
            { status: 500 }
        );
    }
}
