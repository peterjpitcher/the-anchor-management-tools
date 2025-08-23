import 'dotenv/config';
import { getSupabaseAdminClient } from '../src/lib/supabase-singleton.js';

const supabase = getSupabaseAdminClient();

async function checkAttendanceDates() {
  console.log('=== Checking Customer Attendance Dates ===\n');

  try {
    // Get all customer stats with 5+ attendances
    const { data: stats, error } = await supabase
      .from('customer_category_stats')
      .select('customer_id, times_attended, last_attended_date')
      .gte('times_attended', 5)
      .order('last_attended_date', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error fetching stats:', error);
      return;
    }

    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    console.log(`Today: ${today.toISOString().split('T')[0]}`);
    console.log(`90 days ago: ${ninetyDaysAgo.toISOString().split('T')[0]}\n`);

    console.log('Customers with 5+ attendances and their last attendance dates:');
    stats?.forEach(stat => {
      const lastDate = new Date(stat.last_attended_date);
      const daysAgo = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      const isWithin90Days = lastDate >= ninetyDaysAgo;
      
      console.log(`Customer ${stat.customer_id}: ${stat.times_attended} events, last: ${stat.last_attended_date} (${daysAgo} days ago) ${isWithin90Days ? '✅' : '❌'}`);
    });

    // Check total attendance per customer
    console.log('\n=== Total Attendance Per Customer ===');
    const { data: customerTotals, error: totalsError } = await supabase.rpc('get_customer_attendance_totals');

    if (!totalsError && customerTotals) {
      console.log('\nTop 10 customers by total attendance:');
      customerTotals.slice(0, 10).forEach((customer: any) => {
        console.log(`  Customer ${customer.customer_id}: ${customer.total_attended} total events`);
      });
    } else {
      // Manual calculation
      const { data: allStats } = await supabase
        .from('customer_category_stats')
        .select('customer_id, times_attended');

      const totals: Record<string, number> = {};
      allStats?.forEach(stat => {
        totals[stat.customer_id] = (totals[stat.customer_id] || 0) + stat.times_attended;
      });

      const sortedTotals = Object.entries(totals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      console.log('\nTop 10 customers by total attendance:');
      sortedTotals.forEach(([customerId, total]) => {
        console.log(`  Customer ${customerId}: ${total} total events`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

checkAttendanceDates().catch(console.error);