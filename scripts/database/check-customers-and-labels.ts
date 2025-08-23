import { getSupabaseAdminClient } from '../src/lib/supabase-singleton.js';

const supabase = getSupabaseAdminClient();

async function checkCustomersAndLabels() {
  console.log('=== Checking Customers and Label Assignments ===\n');

  // Check customers
  const { count: customerCount, error: customerError } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true });
    
  if (customerError) {
    console.error('Error checking customers:', customerError);
    return;
  }
  
  console.log(`Total customers in database: ${customerCount}`);
  
  // Check label assignments
  const { data: assignments, error: assignmentError } = await supabase
    .from('customer_label_assignments')
    .select(`
      *,
      customer:customers(name),
      label:customer_labels(name, color)
    `)
    .limit(20);
    
  if (assignmentError) {
    console.error('Error checking assignments:', assignmentError);
    return;
  }
  
  console.log(`\nTotal label assignments: ${assignments?.length || 0}`);
  
  if (assignments && assignments.length > 0) {
    console.log('\nSample assignments:');
    assignments.forEach(a => {
      console.log(`  - ${a.customer?.name} → ${a.label?.name}`);
    });
  } else {
    console.log('\n❌ No customer label assignments found!');
    console.log('This is why the "Regular only" filter shows no results.');
  }
  
  // Check if "Regular" label exists
  const { data: regularLabel, error: labelError } = await supabase
    .from('customer_labels')
    .select('*')
    .eq('name', 'Regular')
    .single();
    
  if (labelError) {
    console.error('\nError checking Regular label:', labelError);
  } else if (regularLabel) {
    console.log(`\n✅ "Regular" label exists (ID: ${regularLabel.id})`);
  } else {
    console.log('\n❌ "Regular" label does not exist!');
  }
}

checkCustomersAndLabels().catch(console.error);