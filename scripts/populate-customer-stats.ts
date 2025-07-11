import 'dotenv/config';
import { getSupabaseAdminClient } from '../src/lib/supabase-singleton.js';

const supabase = getSupabaseAdminClient();

async function populateCustomerStats() {
  console.log('=== Populating Customer Category Stats ===\n');

  try {
    // 1. Check if there are any bookings
    console.log('1. Checking bookings...');
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        customer_id,
        event_id,
        seats,
        created_at,
        events!inner(
          id,
          date,
          category_id
        ),
        customers!inner(
          id,
          name
        )
      `)
      .gt('seats', 0) // Only count actual bookings, not reminders
      .order('created_at', { ascending: false })
      .limit(20);

    if (bookingsError) {
      console.error('Error fetching bookings:', bookingsError);
      return;
    }

    console.log(`Found ${bookings?.length || 0} bookings with seats > 0`);
    if (bookings && bookings.length > 0) {
      console.log('\nSample bookings:');
      bookings.slice(0, 5).forEach(b => {
        console.log(`  - ${b.customers?.name} booked ${b.seats} seats for event on ${b.events?.date}`);
      });
    }

    // 2. Check current customer_category_stats
    console.log('\n2. Current customer_category_stats...');
    const { count: currentStatsCount } = await supabase
      .from('customer_category_stats')
      .select('*', { count: 'exact', head: true });

    console.log(`Current stats records: ${currentStatsCount || 0}`);

    // 3. Manually calculate what the stats should be
    console.log('\n3. Calculating customer attendance statistics...');
    
    // Get all bookings with event details
    const { data: allBookings, error: allBookingsError } = await supabase
      .from('bookings')
      .select(`
        customer_id,
        seats,
        events!inner(
          date,
          category_id
        )
      `)
      .gt('seats', 0);

    if (allBookingsError) {
      console.error('Error fetching all bookings:', allBookingsError);
      return;
    }

    // Group by customer and category
    const statsMap: Record<string, {
      times_attended: number;
      first_date: string;
      last_date: string;
      category_id: string;
    }> = {};

    allBookings?.forEach(booking => {
      const key = `${booking.customer_id}-${booking.events.category_id}`;
      if (!statsMap[key]) {
        statsMap[key] = {
          times_attended: 0,
          first_date: booking.events.date,
          last_date: booking.events.date,
          category_id: booking.events.category_id
        };
      }
      
      statsMap[key].times_attended += 1;
      if (booking.events.date < statsMap[key].first_date) {
        statsMap[key].first_date = booking.events.date;
      }
      if (booking.events.date > statsMap[key].last_date) {
        statsMap[key].last_date = booking.events.date;
      }
    });

    console.log(`\nCalculated stats for ${Object.keys(statsMap).length} customer-category combinations`);

    // 4. Insert or update the stats
    console.log('\n4. Updating customer_category_stats table...');
    let updated = 0;
    let inserted = 0;

    for (const [key, stats] of Object.entries(statsMap)) {
      const [customerId, categoryId] = key.split('-');
      
      const { error } = await supabase
        .from('customer_category_stats')
        .upsert({
          customer_id: customerId,
          category_id: categoryId,
          times_attended: stats.times_attended,
          first_attended_date: stats.first_date,
          last_attended_date: stats.last_date,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'customer_id,category_id'
        });

      if (error) {
        console.error(`Error updating stats for ${key}:`, error);
      } else {
        updated++;
      }
    }

    console.log(`✅ Updated ${updated} customer category stats`);

    // 5. Check the results
    console.log('\n5. Checking updated stats...');
    const { data: updatedStats, error: updatedStatsError } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        last_attended_date,
        customers!inner(name),
        event_categories!inner(name)
      `)
      .gte('times_attended', 5)
      .order('times_attended', { ascending: false })
      .limit(10);

    if (updatedStatsError) {
      console.error('Error checking updated stats:', updatedStatsError);
    } else {
      console.log(`\nTop attendees (5+ events):`);
      updatedStats?.forEach(stat => {
        console.log(`  - ${stat.customers?.name}: ${stat.times_attended} ${stat.event_categories?.name} events, last: ${stat.last_attended_date}`);
      });
    }

    // 6. Now try applying labels
    console.log('\n6. Applying customer labels retroactively...');
    const { data: labelResult, error: labelError } = await supabase.rpc('apply_customer_labels_retroactively');

    if (labelError) {
      console.error('Error applying labels:', labelError);
    } else {
      console.log('✅ Labels applied successfully');

      // Check results
      const { count: labelCount } = await supabase
        .from('customer_label_assignments')
        .select('*', { count: 'exact', head: true });

      console.log(`\nTotal label assignments: ${labelCount || 0}`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

populateCustomerStats().catch(console.error);