import { createAdminClient } from '../src/lib/supabase/server';

async function addRedemptionFields() {
  console.log('Adding redemption code fields...');
  
  const supabase = await createAdminClient();
  
  try {
    // Check if columns already exist
    const { data: columns } = await supabase
      .from('information_schema.columns' as any)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'reward_redemptions')
      .in('column_name', ['code', 'expires_at']);
    
    const existingColumns = columns?.map(c => c.column_name) || [];
    console.log('Existing columns:', existingColumns);
    
    // Add code column if it doesn't exist
    if (!existingColumns.includes('code')) {
      console.log('Adding code column...');
      const { error } = await supabase.from('reward_redemptions').select('id').limit(0);
      // This is just to test connection, actual ALTER TABLE needs to be done differently
      
      console.log('Note: You may need to add these columns manually in Supabase Studio:');
      console.log('1. code VARCHAR(10) UNIQUE');
      console.log('2. expires_at TIMESTAMPTZ');
    } else {
      console.log('✓ Code column already exists');
    }
    
    if (!existingColumns.includes('expires_at')) {
      console.log('Note: expires_at column needs to be added');
    } else {
      console.log('✓ Expires_at column already exists');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the script
addRedemptionFields().catch(console.error);