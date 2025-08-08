import { createAdminClient } from '@/lib/supabase/server';

async function analyzeTableBookings() {
  const supabase = await createAdminClient();
  
  console.log('=== TABLE BOOKINGS ANALYSIS ===\n');
  
  try {
    // 1. Count total bookings by status
    const { data: statusCounts, error: statusError } = await supabase
      .from('table_bookings')
      .select('status')
      .then(result => {
        if (result.error) return result;
        const counts = result.data.reduce((acc: any, booking: any) => {
          acc[booking.status] = (acc[booking.status] || 0) + 1;
          return acc;
        }, {});
        return { data: counts, error: null };
      });
    
    if (statusError) {
      console.error('Error counting bookings:', statusError);
      return;
    }
    
    console.log('📊 Booking counts by status:');
    console.log(statusCounts || {});
    console.log('\nTotal bookings:', Object.values(statusCounts || {}).reduce((a: any, b: any) => a + b, 0));
    
    // 2. Check for related records
    console.log('\n📎 Checking related records...\n');
    
    // Table booking items
    const { count: itemsCount } = await supabase
      .from('table_booking_items')
      .select('*', { count: 'exact', head: true });
    console.log(`- Table booking items: ${itemsCount || 0}`);
    
    // Table booking payments
    const { count: paymentsCount } = await supabase
      .from('table_booking_payments')
      .select('*', { count: 'exact', head: true });
    console.log(`- Table booking payments: ${paymentsCount || 0}`);
    
    // Table booking modifications
    const { count: modsCount } = await supabase
      .from('table_booking_modifications')
      .select('*', { count: 'exact', head: true });
    console.log(`- Table booking modifications: ${modsCount || 0}`);
    
    // 3. Check for customers with bookings
    const { data: customersWithBookings, error: customerError } = await supabase
      .from('table_bookings')
      .select('customer_id')
      .not('customer_id', 'is', null)
      .then(result => {
        if (result.error) return result;
        const uniqueCustomers = new Set(result.data.map(b => b.customer_id));
        return { data: Array.from(uniqueCustomers), error: null };
      });
    
    if (!customerError) {
      console.log(`\n👥 Unique customers with bookings: ${customersWithBookings?.length || 0}`);
    }
    
    // 4. Check for future bookings
    const today = new Date().toISOString().split('T')[0];
    const { count: futureCount } = await supabase
      .from('table_bookings')
      .select('*', { count: 'exact', head: true })
      .gte('booking_date', today)
      .in('status', ['confirmed', 'pending_payment']);
    
    console.log(`\n📅 Future bookings (confirmed/pending): ${futureCount || 0}`);
    
    // 5. Check for bookings with payments
    const { data: bookingsWithPayments } = await supabase
      .from('table_booking_payments')
      .select('booking_id, status, amount')
      .eq('status', 'completed');
    
    console.log(`\n💳 Bookings with completed payments: ${bookingsWithPayments?.length || 0}`);
    if (bookingsWithPayments && bookingsWithPayments.length > 0) {
      const totalRevenue = bookingsWithPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      console.log(`   Total revenue: £${totalRevenue.toFixed(2)}`);
    }
    
    // 6. Generate deletion strategy
    console.log('\n\n=== DELETION STRATEGY ===\n');
    console.log('To safely delete all table bookings, execute these SQL commands in order:\n');
    
    console.log('-- Step 1: Disable foreign key constraints temporarily');
    console.log('BEGIN;');
    console.log('');
    
    console.log('-- Step 2: Delete related records (cascade will handle most)');
    console.log('DELETE FROM table_booking_modifications;');
    console.log('DELETE FROM table_booking_payments;');
    console.log('DELETE FROM table_booking_items;');
    console.log('');
    
    console.log('-- Step 3: Delete all bookings');
    console.log('DELETE FROM table_bookings;');
    console.log('');
    
    console.log('-- Step 4: Reset customer booking stats (optional)');
    console.log('UPDATE customers SET ');
    console.log('  table_booking_count = 0,');
    console.log('  no_show_count = 0,');
    console.log('  last_table_booking_date = NULL');
    console.log('WHERE table_booking_count > 0 OR no_show_count > 0;');
    console.log('');
    
    console.log('-- Step 5: Commit the transaction');
    console.log('COMMIT;');
    console.log('');
    
    console.log('-- Optional: Reset booking reference sequence');
    console.log('-- This ensures new bookings start fresh');
    console.log('-- No sequence to reset as references are generated randomly');
    
    console.log('\n⚠️  WARNING: This will permanently delete all table booking data!');
    console.log('📋 Consider creating a backup first:');
    console.log('   - Export table_bookings table');
    console.log('   - Export related tables (items, payments, modifications)');
    
    // 7. Check for any audit logs
    const { count: auditCount } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'table_booking');
    
    console.log(`\n📝 Audit logs for table bookings: ${auditCount || 0}`);
    if (auditCount && auditCount > 0) {
      console.log('   Note: Audit logs will be preserved for historical reference');
    }
    
  } catch (error) {
    console.error('Error analyzing table bookings:', error);
  }
}

// Run the analysis
analyzeTableBookings();