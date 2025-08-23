import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function analyzeAndDeleteBookings() {
  console.log('🔍 Analyzing table bookings...\n');

  try {
    // 1. Count total bookings
    const { count: totalBookings } = await supabase
      .from('table_bookings')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 Total table bookings: ${totalBookings}`);

    if (!totalBookings || totalBookings === 0) {
      console.log('✅ No bookings to delete.');
      return;
    }

    // 2. Count related records
    const { count: menuItems } = await supabase
      .from('table_booking_items')
      .select('*', { count: 'exact', head: true });

    const { count: payments } = await supabase
      .from('table_booking_payments')
      .select('*', { count: 'exact', head: true });

    console.log(`📋 Related records:`);
    console.log(`   - Menu items: ${menuItems || 0}`);
    console.log(`   - Payments: ${payments || 0}`);

    // 3. Get booking status breakdown
    const { data: statusBreakdown } = await supabase
      .from('table_bookings')
      .select('status')
      .order('status');

    const statusCounts: Record<string, number> = {};
    statusBreakdown?.forEach(booking => {
      statusCounts[booking.status] = (statusCounts[booking.status] || 0) + 1;
    });

    console.log(`\n📈 Bookings by status:`);
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   - ${status}: ${count}`);
    });

    // 4. Show sample bookings
    const { data: sampleBookings } = await supabase
      .from('table_bookings')
      .select('booking_reference, booking_date, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log(`\n📝 Recent bookings (last 5):`);
    sampleBookings?.forEach((booking, index) => {
      console.log(`   ${index + 1}. ${booking.booking_reference} - ${booking.booking_date} (${booking.status})`);
    });

    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will delete ALL table bookings and related data!');
    console.log('This includes:');
    console.log('- All table bookings');
    console.log('- All menu items (table_booking_items)');
    console.log('- All payments (table_booking_payments)');
    console.log('- Any SMS jobs related to bookings');
    console.log('\nTo proceed, run this script with the --confirm flag:');
    console.log('tsx scripts/delete-all-table-bookings.ts --confirm\n');

    if (process.argv.includes('--confirm')) {
      console.log('🗑️  Deleting all table bookings...\n');

      // Delete in correct order to respect foreign key constraints
      
      // 1. Delete menu items first
      if (menuItems && menuItems > 0) {
        console.log('Deleting menu items...');
        const { error: itemsError } = await supabase
          .from('table_booking_items')
          .delete()
          .gte('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (itemsError) {
          console.error('❌ Error deleting menu items:', itemsError);
          return;
        }
        console.log(`✅ Deleted ${menuItems} menu items`);
      }

      // 2. Delete payments
      if (payments && payments > 0) {
        console.log('Deleting payments...');
        const { error: paymentsError } = await supabase
          .from('table_booking_payments')
          .delete()
          .gte('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (paymentsError) {
          console.error('❌ Error deleting payments:', paymentsError);
          return;
        }
        console.log(`✅ Deleted ${payments} payments`);
      }

      // 3. Delete pending SMS jobs for table bookings
      console.log('Cleaning up SMS jobs...');
      const { data: smsJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('type', 'send_sms')
        .eq('status', 'pending')
        .or('payload->template.like.%booking%,payload->template.like.%table%');

      if (smsJobs && smsJobs.length > 0) {
        const { error: jobsError } = await supabase
          .from('jobs')
          .delete()
          .in('id', smsJobs.map(j => j.id));

        if (jobsError) {
          console.error('⚠️  Warning: Could not delete SMS jobs:', jobsError);
        } else {
          console.log(`✅ Deleted ${smsJobs.length} pending SMS jobs`);
        }
      }

      // 4. Finally, delete the bookings
      console.log('Deleting table bookings...');
      const { error: bookingsError } = await supabase
        .from('table_bookings')
        .delete()
        .gte('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (bookingsError) {
        console.error('❌ Error deleting bookings:', bookingsError);
        return;
      }

      console.log(`✅ Deleted ${totalBookings} table bookings`);
      console.log('\n🎉 All table bookings and related data have been deleted successfully!');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
analyzeAndDeleteBookings();