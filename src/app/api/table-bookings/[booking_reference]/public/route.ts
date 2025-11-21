import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ booking_reference: string }> }
) {
  const params = await props.params;
  
  try {
    const supabase = createAdminClient();
    
    // Get booking with limited information for public view
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        booking_type,
        table_booking_items(
          quantity,
          price_at_booking,
          custom_item_name,
          guest_name,
          special_requests,
          item_type
        )
      `)
      .eq('booking_reference', params.booking_reference)
      .single();

    if (error || !booking) {
      console.error('Booking lookup error:', error);
      console.error('Booking reference:', params.booking_reference);
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Only return limited information for security
    return NextResponse.json({
      id: booking.id,
      booking_reference: booking.booking_reference,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
      party_size: booking.party_size,
      status: booking.status,
      booking_type: booking.booking_type,
      items: booking.table_booking_items,
      requires_payment: booking.status === 'pending_payment' && booking.booking_type === 'sunday_lunch'
    });
  } catch (error) {
    console.error('Error fetching booking:', error);
    return NextResponse.json(
      { error: 'Failed to fetch booking' },
      { status: 500 }
    );
  }
}