import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
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
    
    // Get event details with booking count
    const { data: event, error } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        event_status,
        bookings(count)
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

    const bookingCount = event.bookings?.[0]?.count || 0;
    const capacity = event.capacity || 100; // Default capacity
    const availableSeats = capacity - bookingCount;
    const isAvailable = availableSeats >= seats;

    return createApiResponse({
      available: isAvailable,
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