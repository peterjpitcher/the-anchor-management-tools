import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { use } from 'react';

export default async function PaymentRedirectPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const resolvedParams = await params;
  const supabase = await createClient();
  
  // Get booking reference by ID
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('booking_reference')
    .eq('id', resolvedParams.id)
    .single();
    
  if (error || !booking) {
    // If booking not found, redirect to bookings list with error
    redirect('/table-bookings?error=booking_not_found');
  }
  
  // Redirect to the correct payment page using booking reference
  redirect(`/table-booking/${booking.booking_reference}/payment`);
}