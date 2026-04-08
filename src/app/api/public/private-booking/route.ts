import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PrivateBookingService, type CreatePrivateBookingInput } from '@/services/private-bookings';
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
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications';
import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile';

const BookingItemSchema = z.object({
    item_type: z.enum(['space', 'catering', 'vendor', 'other']),
    space_id: z.string().optional(),
    package_id: z.string().optional(),
    vendor_id: z.string().optional(),
    description: z.string().min(1).max(500),
    quantity: z.number().int().min(1).max(1000),
    unit_price: z.number().min(0).max(100000),
    discount_type: z.enum(['percent', 'fixed']).optional(),
    discount_value: z.number().min(0).optional(),
    discount_reason: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
});

const PublicBookingSchema = z.object({
    customer_first_name: z.string().min(1, 'First name is required').max(100),
    customer_last_name: z.string().min(1).max(100).optional(),
    contact_phone: z.string().min(5, 'Phone number is required'),
    contact_email: z.string().email().max(320).optional(),
    default_country_code: z.string().regex(/^\d{1,4}$/, 'default_country_code must be 1 to 4 digits').optional(),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'event_date must be YYYY-MM-DD').optional(),
    start_time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'start_time must be HH:MM').optional(),
    end_time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'end_time must be HH:MM').optional(),
    setup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'setup_date must be YYYY-MM-DD').optional(),
    setup_time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'setup_time must be HH:MM').optional(),
    guest_count: z
        .preprocess((value) => {
            if (typeof value === 'number') return value;
            if (typeof value === 'string' && value.length > 0) return Number.parseInt(value, 10);
            return undefined;
        }, z.number().int().min(1).max(50))
        .optional(),
    event_type: z.string().min(1).max(100).optional(),
    customer_requests: z.string().max(2000).optional(),
    special_requirements: z.string().max(2000).optional(),
    accessibility_needs: z.string().max(2000).optional(),
    date_tbd: z.boolean().optional(),
    items: z.array(BookingItemSchema).max(50).optional(),
});

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

        // Turnstile CAPTCHA verification
        const turnstileToken = request.headers.get('x-turnstile-token');
        const clientIp = getClientIp(request);
        const turnstile = await verifyTurnstileToken(turnstileToken, clientIp);
        if (!turnstile.success) {
            return NextResponse.json(
                { success: false, error: turnstile.error || 'Bot verification failed' },
                { status: 403 }
            );
        }

        let rawPayload: unknown;
        try {
            rawPayload = await request.json();
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

        const parsed = PublicBookingSchema.safeParse(rawPayload);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || 'Invalid booking payload' },
                { status: 400 }
            );
        }
        const body = parsed.data;

        let normalizedPhone: string | undefined;
        if (body.contact_phone.trim().length > 0) {
            try {
                normalizedPhone = formatPhoneForStorage(body.contact_phone, {
                    defaultCountryCode: body.default_country_code
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
            // Whitelist only the Zod-validated fields a public caller should set.
            // Explicitly exclude: customer_id, deposit_amount, balance_due_date,
            // hold_expiry, status, created_by, source, internal_notes, contract_note.
            const bookingPayload: CreatePrivateBookingInput = {
                customer_first_name: body.customer_first_name,
                customer_last_name: body.customer_last_name,
                contact_phone: normalizedPhone || body.contact_phone,
                contact_email: body.contact_email,
                event_date: body.event_date,
                start_time: body.start_time,
                end_time: body.end_time,
                setup_date: body.setup_date,
                setup_time: body.setup_time,
                guest_count: body.guest_count,
                event_type: body.event_type,
                customer_requests: body.customer_requests,
                special_requirements: body.special_requirements,
                accessibility_needs: body.accessibility_needs,
                date_tbd: body.date_tbd,
                items: body.items,
                // Server-controlled fields — never trust the caller
                status: 'draft',
                source: 'website',
            };

            const booking = await PrivateBookingService.createBooking(bookingPayload);
            createdBookingId = typeof booking?.id === 'string' ? booking.id : null;

            try {
                const managerEmailResult = await sendManagerPrivateBookingCreatedEmail({
                    booking: booking as any,
                    createdVia: 'api_public_private_booking'
                });

                if (!managerEmailResult.sent && managerEmailResult.error) {
                    logger.warn('Failed to send manager private booking created email (public endpoint)', {
                        metadata: {
                            privateBookingId: createdBookingId,
                            error: managerEmailResult.error
                        }
                    });
                }
            } catch (managerEmailError) {
                logger.warn('Manager private booking created email task rejected unexpectedly (public endpoint)', {
                    metadata: {
                        privateBookingId: createdBookingId,
                        error: managerEmailError instanceof Error ? managerEmailError.message : String(managerEmailError)
                    }
                });
            }

            if (booking?.customer_id) {
                await recordPublicPrivateBookingAnalyticsSafe(supabase, {
                    customerId: booking.customer_id,
                    privateBookingId: booking.id,
                    eventType: 'private_booking_enquiry_created',
                    metadata: {
                        source: 'brand_site'
                    }
                }, {
                    privateBookingId: booking.id,
                    customerId: booking.customer_id
                });
            }

            // Audit log for successful private booking creation
            try {
                await logAuditEvent({
                    operation_type: 'create',
                    resource_type: 'private_booking',
                    resource_id: booking.id,
                    operation_status: 'success',
                    additional_info: {
                        source: 'website',
                        endpoint: '/api/public/private-booking',
                    },
                });
            } catch (auditError) {
                logger.warn('Failed to log audit event for public private booking creation', {
                    metadata: {
                        privateBookingId: booking.id,
                        error: auditError instanceof Error ? auditError.message : String(auditError),
                    },
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
