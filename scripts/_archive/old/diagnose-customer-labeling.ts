import 'dotenv/config';
import { getSupabaseAdminClient } from '../src/lib/supabase-singleton.js';

const supabase = getSupabaseAdminClient();

async function diagnoseCustomerLabeling() {
  console.log('=== Customer Labeling Diagnosis ===\n');

  try {
    // 1. Check if labels exist with auto-apply rules
    console.log('1. Checking customer labels with auto-apply rules...');
    const { data: labels, error: labelsError } = await supabase
      .from('customer_labels')
      .select('*')
      .not('auto_apply_rules', 'is', null);

    if (labelsError) {
      console.error('Error fetching labels:', labelsError);
      return;
    }

    console.log(`Found ${labels?.length || 0} labels with auto-apply rules:`);
    labels?.forEach(label => {
      console.log(`  - ${label.name}: ${JSON.stringify(label.auto_apply_rules)}`);
    });

    // 2. Check customer_category_stats table
    console.log('\n2. Checking customer_category_stats table...');
    const { count: statsCount, error: statsError } = await supabase
      .from('customer_category_stats')
      .select('*', { count: 'exact', head: true });

    if (statsError) {
      console.error('Error checking stats:', statsError);
    } else {
      console.log(`Total customer_category_stats records: ${statsCount || 0}`);
    }

    // 3. Check for customers meeting "Regular" criteria (5+ events in last 90 days)
    console.log('\n3. Checking customers who meet "Regular" criteria...');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: regularCandidates, error: regularError } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        last_attended_date
      `)
      .gte('last_attended_date', ninetyDaysAgo.toISOString().split('T')[0])
      .gte('times_attended', 5);
    
    // Get customer names separately
    let customerNames: Record<string, string> = {};
    if (regularCandidates && regularCandidates.length > 0) {
      const customerIds = [...new Set(regularCandidates.map(c => c.customer_id))];
      const { data: customers } = await supabase
        .from('customers')
        .select('id, name')
        .in('id', customerIds);
      
      if (customers) {
        customerNames = customers.reduce((acc, c) => {
          acc[c.id] = c.name;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    if (regularError) {
      console.error('Error checking regular candidates:', regularError);
    } else {
      console.log(`Found ${regularCandidates?.length || 0} customers who qualify for "Regular" label`);
      if (regularCandidates && regularCandidates.length > 0) {
        console.log('Sample qualifying customers:');
        regularCandidates.slice(0, 5).forEach(c => {
          const customerName = customerNames[c.customer_id] || 'Unknown';
          console.log(`  - ${customerName}: ${c.times_attended} events, last: ${c.last_attended_date}`);
        });
      }
    }

    // 4. Check total attendance across categories for each customer
    console.log('\n4. Checking total attendance across all categories...');
    const { data: totalAttendance, error: totalError } = await supabase.rpc('get_customer_total_attendance');

    if (totalError) {
      // If function doesn't exist, do it manually
      const { data: manualTotal, error: manualError } = await supabase
        .from('customer_category_stats')
        .select('customer_id, times_attended');

      if (!manualError && manualTotal) {
        const customerTotals: Record<string, number> = {};
        manualTotal.forEach(stat => {
          customerTotals[stat.customer_id] = (customerTotals[stat.customer_id] || 0) + stat.times_attended;
        });

        const qualifyingCustomers = Object.entries(customerTotals)
          .filter(([_, total]) => total >= 5)
          .length;

        console.log(`Total customers with 5+ attendances: ${qualifyingCustomers}`);
      }
    }

    // 5. Check if the apply function exists
    console.log('\n5. Testing apply_customer_labels_retroactively function...');
    const { data: functionResult, error: functionError } = await supabase.rpc('apply_customer_labels_retroactively');

    if (functionError) {
      console.error('Error running apply function:', functionError);
      console.log('\nPossible issues:');
      console.log('- The function might not exist in the database');
      console.log('- There might be a permissions issue');
      console.log('- The function logic might have an error');
    } else {
      console.log('✅ Function executed successfully');
      console.log('Result:', functionResult);
    }

    // 6. Check current label assignments
    console.log('\n6. Checking current label assignments...');
    const { count: assignmentCount, error: assignmentError } = await supabase
      .from('customer_label_assignments')
      .select('*', { count: 'exact', head: true });

    if (assignmentError) {
      console.error('Error checking assignments:', assignmentError);
    } else {
      console.log(`Total label assignments after running function: ${assignmentCount || 0}`);
    }

    // 7. Check for new customers (joined in last 30 days)
    console.log('\n7. Checking for new customers (last 30 days)...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: newCustomerCount, error: newCustomerError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (newCustomerError) {
      console.error('Error checking new customers:', newCustomerError);
    } else {
      console.log(`New customers in last 30 days: ${newCustomerCount || 0}`);
    }

    // 8. Summary and recommendations
    console.log('\n=== Summary ===');
    console.log('If no customers are being labeled, check:');
    console.log('1. Do customers have attendance records in customer_category_stats?');
    console.log('2. Are the attendance dates recent enough (within 90 days for Regular)?');
    console.log('3. Do customers meet the minimum attendance requirements?');
    console.log('4. Is the apply_customer_labels_retroactively function working?');
    console.log('\nRun this script after some events have occurred and customers have attended.');

  } catch (error) {
    console.error('Diagnostic error:', error);
  }
}

diagnoseCustomerLabeling().catch(console.error);