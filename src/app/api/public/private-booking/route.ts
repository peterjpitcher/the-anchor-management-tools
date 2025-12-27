import { NextResponse } from 'next/server';
import { PrivateBookingService, type CreatePrivateBookingInput } from '@/services/private-bookings';
import type { BookingItemFormData } from '@/types/private-bookings';

// Schema for public booking requests
// Simplified version of the internal types but stricter validation could be added here
interface PublicBookingRequest extends CreatePrivateBookingInput {
    items?: BookingItemFormData[];
}

/**
 * Public endpoint to create a private booking.
 * Accepts booking details and items, creates a draft booking.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Basic validation
        if (!body.customer_first_name || !body.contact_phone) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Ensure status is forced to draft and source is website
        const bookingPayload: CreatePrivateBookingInput = {
            ...body,
            status: 'draft',
            source: 'website',
            // Ensure items are properly typed even if passed from frontend
            items: body.items
        };

        const booking = await PrivateBookingService.createBooking(bookingPayload);

        return NextResponse.json({
            success: true,
            data: {
                id: booking.id,
                reference: booking.booking_reference // If available, otherwise just ID
            }
        });
    } catch (error) {
        console.error('Error creating private booking:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create booking' },
            { status: 500 }
        );
    }
}
