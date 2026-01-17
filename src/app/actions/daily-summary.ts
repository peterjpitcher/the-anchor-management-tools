'use server';

import { EventService } from '@/services/events';
import { PrivateBookingService } from '@/services/private-bookings';

export async function getDailySummaryAction(date: string) {
  try {
    const [events, privateBookings] = await Promise.all([
      EventService.getEventsByDate(date),
      PrivateBookingService.getBookings({ fromDate: date, toDate: date }),
    ]);

    const activePrivateBookings = privateBookings?.data?.filter((b: any) => b.status !== 'cancelled') || [];

    const summaryParts: string[] = [];

    if (events && events.length > 0) {
      summaryParts.push('EVENTS:');
      events.forEach((e: any) => {
        summaryParts.push(`- ${e.name} (${e.time || 'Time TBC'})`);
      });
      summaryParts.push('');
    }

    if (activePrivateBookings.length > 0) {
      summaryParts.push('PRIVATE BOOKINGS:');
      activePrivateBookings.forEach((pb: any) => {
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
