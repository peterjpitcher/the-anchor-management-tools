'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EventService } from '@/services/events';
import { PrivateBookingService } from '@/services/private-bookings';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export async function getDailySummaryAction(date: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const parsed = dateSchema.safeParse(date);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid date' };
  }

  try {
    const [events, privateBookings] = await Promise.all([
      EventService.getEventsByDate(parsed.data),
      PrivateBookingService.getBookings({ fromDate: parsed.data, toDate: parsed.data }),
    ]);

    const activePrivateBookings = privateBookings?.data?.filter(
      (b: { status: string }) => b.status !== 'cancelled'
    ) || [];

    const summaryParts: string[] = [];

    if (events && events.length > 0) {
      summaryParts.push('EVENTS:');
      events.forEach((e: { name: string; time?: string | null }) => {
        summaryParts.push(`- ${e.name} (${e.time || 'Time TBC'})`);
      });
      summaryParts.push('');
    }

    if (activePrivateBookings.length > 0) {
      summaryParts.push('PRIVATE BOOKINGS:');
      activePrivateBookings.forEach((pb: { customer_name?: string; event_type?: string; guest_count?: number }) => {
        summaryParts.push(`- ${pb.customer_name || 'Unknown'} (${pb.event_type || 'Private Event'}, ${pb.guest_count || 0} guests)`);
      });
      summaryParts.push('');
    }

    return {
      success: true,
      summary: summaryParts.join('\n').trim(),
      data: {
        events: events || [],
        privateBookings: activePrivateBookings,
      }
    };
  } catch (error) {
    console.error('Error getting daily summary:', error);
    return { success: false, error: 'Failed to fetch summary' };
  }
}
