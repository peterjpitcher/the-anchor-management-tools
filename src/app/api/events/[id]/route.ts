import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { eventToSchema } from '@/lib/api/schema';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withApiAuth(async (req, apiKey) => {
    const params = await context.params;
    const supabase = createAdminClient();
    
    const { data: event, error } = await supabase
      .from('events')
      .select(`
        *,
        category:event_categories(
          id,
          name,
          description,
          color,
          icon
        ),
        bookings(count),
        event_message_templates(
          template_type,
          custom_content
        )
      `)
      .eq('id', params.id)
      .single();

    if (error || !event) {
      return createErrorResponse('Event not found', 'NOT_FOUND', 404);
    }

    const bookingCount = event.bookings?.[0]?.count || 0;

    // Add extended details
    const extendedEvent = {
      id: event.id,
      ...eventToSchema(event, bookingCount),
      booking_rules: {
        max_seats_per_booking: 6,
        requires_customer_details: true,
        allows_notes: true,
        sms_confirmation_enabled: true,
      },
      custom_messages: event.event_message_templates?.reduce((acc: any, template: any) => {
        acc[template.template_type] = template.custom_content;
        return acc;
      }, {}),
    };

    return createApiResponse({
      ...extendedEvent,
    });
  }, ['read:events'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}