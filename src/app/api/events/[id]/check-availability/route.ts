import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';

const checkAvailabilitySchema = z.object({
  seats: z.number().min(1).max(10),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withApiAuth(async (_req, _apiKey) => {
    const params = await context.params;
    const body = await request.json();
    
    // Validate input
    const validation = checkAvailabilitySchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors[0].message,
        'VALIDATION_ERROR',
        400
      );
    }

    const { seats } = validation.data;
    const supabase = createAdminClient();
    
    // Get event details with bookings
    const { data: event, error } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        event_status,
        booking_totals:bookings(sum:seats)
      `)
      .eq('id', params.id)
      .single();

    if (error || !event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }

    // Check if event is scheduled
    if (event.event_status !== 'scheduled') {
      return createErrorResponse(
        'Event is not available for booking',
        'EVENT_NOT_AVAILABLE',
        400
      );
    }

    // Check if event date has passed
    const eventDateTime = new Date(`${event.date}T${event.time}`);
    if (eventDateTime < new Date()) {
      return createErrorResponse(
        'Event has already occurred',
        'EVENT_PAST',
        400
      );
    }

    const bookedSeats = (event.booking_totals?.[0]?.sum as number | null) ?? 0;
    const capacity = event.capacity; // null means uncapped
    const availableSeatsRaw = capacity === null ? null : (capacity || 0) - bookedSeats;
    const availableSeats = availableSeatsRaw === null ? null : Math.max(0, availableSeatsRaw);
    const isAvailable = capacity === null ? true : (availableSeats !== null && availableSeats >= seats);
    const capacityValue = capacity ?? 0;
    const remaining = capacity === null ? 9999 : Math.max(0, capacityValue - bookedSeats);
    const percentageFull = capacityValue > 0
      ? Math.min(100, Math.round((bookedSeats / capacityValue) * 100))
      : 0;

    return createApiResponse({
      available: isAvailable,
      event_id: event.id,
      capacity: capacityValue,
      booked: bookedSeats,
      remaining,
      percentage_full: percentageFull,
      available_seats: availableSeats,
      requested_seats: seats,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        time: event.time,
      },
    });
  }, ['read:events'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
