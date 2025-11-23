'use server';

import { EventService } from '@/services/events';
import { PrivateBookingService } from '@/services/private-bookings';
import { TableBookingService } from '@/services/table-bookings';

export async function getDailySummaryAction(date: string) {
  try {
    const [events, privateBookings, tableBookings] = await Promise.all([
      EventService.getEventsByDate(date),
      PrivateBookingService.getBookings({ fromDate: date, toDate: date }),
      TableBookingService.getBookingsByDate(date),
    ]);

    const activePrivateBookings = privateBookings?.data?.filter((b: any) => b.status !== 'cancelled') || [];

    const summaryParts: string[] = [];

    if (events && events.length > 0) {
      summaryParts.push('EVENTS:');
      events.forEach((e: any) => {
        summaryParts.push(`- ${e.name} (${e.time}, ${e.booked_count || 0} booked)`);
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

    if (tableBookings && tableBookings.length > 0) {
      summaryParts.push(`TABLE BOOKINGS: ${tableBookings.length} bookings`);
      // Maybe list large ones? For now just count.
       tableBookings.forEach((tb: any) => {
           summaryParts.push(`- ${tb.customer?.first_name} ${tb.customer?.last_name} (${tb.booking_time}, ${tb.party_size} covers)`);
       });
       summaryParts.push('');
    }

    return { 
      success: true, 
      summary: summaryParts.join('\n').trim(),
      data: {
        events: events || [],
        privateBookings: activePrivateBookings,
        tableBookings: tableBookings || []
      }
    };
  } catch (error) {
    console.error('Error getting daily summary:', error);
    return { success: false, error: 'Failed to fetch summary' };
  }
}
