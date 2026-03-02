'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
    const adminClient = createAdminClient();

    const [events, privateBookings, tableBookingsResult] = await Promise.all([
      EventService.getEventsByDate(parsed.data),
      PrivateBookingService.getBookings({ fromDate: parsed.data, toDate: parsed.data }),
      adminClient
        .from('table_bookings')
        .select('id, booking_time, booking_type, party_size, status')
        .eq('booking_date', parsed.data)
        .neq('status', 'cancelled')
        .order('booking_time', { ascending: true }),
    ]);

    const activePrivateBookings = privateBookings?.data?.filter(
      (b: { status: string }) => b.status !== 'cancelled'
    ) || [];

    const tableBookings = tableBookingsResult.data || [];

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

    if (tableBookings.length > 0) {
      const totalCovers = tableBookings.reduce((sum: number, b: { party_size: number }) => sum + b.party_size, 0);
      const noShows = tableBookings.filter((b: { status: string }) => b.status === 'no_show').length;
      summaryParts.push('TABLE BOOKINGS:');
      summaryParts.push(`${tableBookings.length} booking${tableBookings.length !== 1 ? 's' : ''} (${totalCovers} covers)${noShows > 0 ? `, ${noShows} no-show${noShows !== 1 ? 's' : ''}` : ''}`);
      summaryParts.push('');
    }

    return {
      success: true,
      summary: summaryParts.join('\n').trim(),
      data: {
        events: events || [],
        privateBookings: activePrivateBookings,
        tableBookings,
      }
    };
  } catch (error) {
    console.error('Error getting daily summary:', error);
    return { success: false, error: 'Failed to fetch summary' };
  }
}
