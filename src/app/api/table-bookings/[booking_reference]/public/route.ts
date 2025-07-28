import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

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
        customer:customers!customer_id(
          first_name,
          last_name
        ),
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
    
    // Type assertion for customer field
    const typedBooking = booking as typeof booking & {
      customer: { first_name: string; last_name: string }
    };

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
      id: typedBooking.id,
      booking_reference: typedBooking.booking_reference,
      booking_date: typedBooking.booking_date,
      booking_time: typedBooking.booking_time,
      party_size: typedBooking.party_size,
      status: typedBooking.status,
      booking_type: typedBooking.booking_type,
      customer_name: `${typedBooking.customer.first_name} ${typedBooking.customer.last_name}`,
      items: typedBooking.table_booking_items,
      requires_payment: typedBooking.status === 'pending_payment' && typedBooking.booking_type === 'sunday_lunch'
    });
  } catch (error) {
    console.error('Error fetching booking:', error);
    return NextResponse.json(
      { error: 'Failed to fetch booking' },
      { status: 500 }
    );
  }
}