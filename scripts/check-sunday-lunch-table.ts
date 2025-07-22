import { createAdminClient } from '@/lib/supabase/server';

async function checkSundayLunchTable() {
  const supabase = await createAdminClient();
  
  try {
    // Try to query the table
    const { data, error } = await supabase
      .from('sunday_lunch_menu_items')
      .select('count')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') {
        console.log('❌ Table sunday_lunch_menu_items does not exist');
        console.log('You can safely create it with the migration.');
      } else {
        console.log('❌ Error checking table:', error.message);
      }
    } else {
      console.log('✅ Table sunday_lunch_menu_items already exists');
      
      // Get count of items
      const { count } = await supabase
        .from('sunday_lunch_menu_items')
        .select('*', { count: 'exact', head: true });
      
      console.log(`   Contains ${count || 0} items`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

checkSundayLunchTable();