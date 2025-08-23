import { config } from 'dotenv';
import { createAdminClient } from '../src/lib/supabase/server.js';

// Load environment variables
config({ path: '.env.local' });

async function deletePeterPitcherBookings() {
  const supabase = createAdminClient();
  
  console.log('🔍 Finding all table bookings for Peter Pitcher...\n');
  
  try {
    // First, find all customers named Peter Pitcher
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number')
      .or('first_name.ilike.%peter%,last_name.ilike.%pitcher%')
      .or('last_name.ilike.%peter%,first_name.ilike.%pitcher%');
    
    if (customerError) {
      console.error('Error finding customers:', customerError);
      return;
    }
    
    if (!customers || customers.length === 0) {
      console.log('No customers found with name Peter Pitcher');
      return;
    }
    
    console.log(`Found ${customers.length} customer(s) matching "Peter Pitcher":`);
    customers.forEach(c => {
      console.log(`  - ${c.first_name} ${c.last_name} (${c.mobile_number}) - ID: ${c.id}`);
    });
    console.log();
    
    // Get all table bookings for these customers
    const customerIds = customers.map(c => c.id);
    
    const { data: bookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select(`
        id,
        reference,
        date,
        time,
        party_size,
        status,
        customer:customers!inner(
          first_name,
          last_name
        )
      `)
      .in('customer_id', customerIds)
      .order('date', { ascending: false });
    
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
      console.log(`  - ${b.reference} | ${b.date} ${b.time} | Party of ${b.party_size} | Status: ${b.status}`);
    });
    console.log();
    
    // Confirm deletion
    console.log('⚠️  WARNING: This will permanently delete these bookings.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Delete the bookings
    console.log('🗑️  Deleting bookings...');
    
    const bookingIds = bookings.map(b => b.id);
    
    const { error: deleteError, count } = await supabase
      .from('table_bookings')
      .delete()
      .in('id', bookingIds);
    
    if (deleteError) {
      console.error('Error deleting bookings:', deleteError);
      return;
    }
    
    console.log(`✅ Successfully deleted ${bookings.length} booking(s)`);
    
    // Log this action for audit purposes
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'bulk_delete',
        entity_type: 'table_bookings',
        entity_id: null,
        metadata: {
          reason: 'Deleted test bookings for Peter Pitcher',
          booking_ids: bookingIds,
          count: bookings.length
        }
      });
      console.log('📝 Audit log created');
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the deletion
deletePeterPitcherBookings().catch(console.error);