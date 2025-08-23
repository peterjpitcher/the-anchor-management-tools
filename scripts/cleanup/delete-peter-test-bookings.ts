import { config } from 'dotenv';
import { createAdminClient } from '../src/lib/supabase/server.js';

// Load environment variables
config({ path: '.env.local' });

async function deletePeterTestBookings() {
  const supabase = createAdminClient();
  
  const customerId = 'ba19868e-5e0d-4fa0-a992-e54207e1c8c7'; // Peter Pitcher's ID
  
  console.log('🔍 Finding all table bookings for Peter Pitcher (ID: ' + customerId + ')...\n');
  
  try {
    // Get customer details first
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('first_name, last_name, mobile_number')
      .eq('id', customerId)
      .single();
    
    if (customerError || !customer) {
      console.error('Error finding customer:', customerError);
      return;
    }
    
    console.log(`Customer: ${customer.first_name} ${customer.last_name} (${customer.mobile_number})\n`);
    
    // Get all table bookings for this customer
    const { data: bookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('customer_id', customerId)
      .order('booking_date', { ascending: false });
    
    if (bookingsError) {
      console.error('Error finding bookings:', bookingsError);
      return;
    }
    
    if (!bookings || bookings.length === 0) {
      console.log('No table bookings found for Peter Pitcher');
      return;
    }
    
    console.log(`Found ${bookings.length} table booking(s):`);
    bookings.forEach(b => {
      console.log(`  - Ref: ${b.booking_reference} | ${b.booking_date} ${b.booking_time} | Party of ${b.party_size} | Status: ${b.status}`);
      if (b.special_requirements) {
        console.log(`    Notes: ${b.special_requirements}`);
      }
    });
    console.log();
    
    // Confirm deletion
    console.log('⚠️  WARNING: This will permanently delete these bookings.');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to proceed...\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Delete the bookings
    console.log('🗑️  Deleting bookings...');
    
    const bookingIds = bookings.map(b => b.id);
    
    const { error: deleteError } = await supabase
      .from('table_bookings')
      .delete()
      .in('id', bookingIds);
    
    if (deleteError) {
      console.error('Error deleting bookings:', deleteError);
      return;
    }
    
    console.log(`✅ Successfully deleted ${bookings.length} booking(s)`);
    
    // Log this action for audit purposes
    await supabase.from('audit_logs').insert({
      user_id: customerId, // Using customer ID as reference
      action: 'bulk_delete',
      entity_type: 'table_bookings',
      entity_id: null,
      metadata: {
        reason: 'Deleted test bookings for Peter Pitcher',
        customer_name: `${customer.first_name} ${customer.last_name}`,
        booking_ids: bookingIds,
        count: bookings.length
      }
    });
    console.log('📝 Audit log created');
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the deletion
deletePeterTestBookings().catch(console.error);