import 'dotenv/config';
import { getSupabaseAdminClient } from '../src/lib/supabase-singleton.js';

const supabase = getSupabaseAdminClient();

async function checkRecentAttendance() {
  console.log('=== Checking Recent Attendance ===\n');

  try {
    // First, check if we have any recent bookings
    console.log('1. Checking recent bookings (last 90 days)...');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: recentBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        customer_id,
        seats,
        created_at,
        events!inner(
          date,
          name
        )
      `)
      .gte('events.date', ninetyDaysAgo.toISOString().split('T')[0])
      .gt('seats', 0)
      .order('events.date', { ascending: false })
      .limit(10);

    if (bookingsError) {
      console.error('Error fetching bookings:', bookingsError);
    } else {
      console.log(`Found ${recentBookings?.length || 0} recent bookings`);
      if (recentBookings && recentBookings.length > 0) {
        console.log('\nSample recent bookings:');
        recentBookings.forEach(b => {
          console.log(`  - Customer ${b.customer_id} booked ${b.seats} seats for "${b.events.name}" on ${b.events.date}`);
        });
      }
    }

    // Check customer_category_stats for recent attendance
    console.log('\n2. Checking customer_category_stats for recent attendance...');
    const { data: recentStats, error: statsError } = await supabase
      .from('customer_category_stats')
      .select('*')
      .gte('last_attended_date', ninetyDaysAgo.toISOString().split('T')[0])
      .order('last_attended_date', { ascending: false })
      .limit(10);

    if (statsError) {
      console.error('Error fetching stats:', statsError);
    } else {
      console.log(`Found ${recentStats?.length || 0} customers with attendance in last 90 days`);
      if (recentStats && recentStats.length > 0) {
        console.log('\nSample recent attendees:');
        recentStats.forEach(s => {
          console.log(`  - Customer ${s.customer_id}: ${s.times_attended} events, last: ${s.last_attended_date}`);
        });
      }
    }

    // Check for customers who meet Regular criteria
    console.log('\n3. Checking who qualifies for Regular label...');
    const { data: qualifiers, error: qualError } = await supabase
      .from('customer_category_stats')
      .select('customer_id, times_attended, last_attended_date')
      .gte('last_attended_date', ninetyDaysAgo.toISOString().split('T')[0]);

    if (!qualError && qualifiers) {
      // Group by customer and sum attendance
      const customerTotals: Record<string, { total: number, lastDate: string }> = {};
      qualifiers.forEach(q => {
        if (!customerTotals[q.customer_id]) {
          customerTotals[q.customer_id] = { total: 0, lastDate: q.last_attended_date };
        }
        customerTotals[q.customer_id].total += q.times_attended;
        if (q.last_attended_date > customerTotals[q.customer_id].lastDate) {
          customerTotals[q.customer_id].lastDate = q.last_attended_date;
        }
      });

      const regularQualifiers = Object.entries(customerTotals)
        .filter(([_, data]) => data.total >= 5)
        .map(([customerId, data]) => ({ customerId, ...data }));

      console.log(`\nCustomers who qualify for Regular label: ${regularQualifiers.length}`);
      if (regularQualifiers.length > 0) {
        console.log('Qualifiers:');
        regularQualifiers.slice(0, 5).forEach(q => {
          console.log(`  - Customer ${q.customerId}: ${q.total} total events, last: ${q.lastDate}`);
        });
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

checkRecentAttendance().catch(console.error);