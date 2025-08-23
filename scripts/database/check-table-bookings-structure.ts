import { config } from 'dotenv';
import { createAdminClient } from '../src/lib/supabase/server.js';

// Load environment variables
config({ path: '.env.local' });

async function checkTableStructure() {
  const supabase = createAdminClient();
  
  console.log('Checking table_bookings structure...\n');
  
  try {
    // Get a sample record to see the structure
    const { data: sample, error } = await supabase
      .from('table_bookings')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    if (sample && sample.length > 0) {
      console.log('Table columns:');
      Object.keys(sample[0]).forEach(key => {
        const value = sample[0][key];
        const type = value === null ? 'null' : typeof value;
        console.log(`  - ${key}: ${type}`);
      });
      
      console.log('\nSample record:');
      console.log(JSON.stringify(sample[0], null, 2));
    } else {
      console.log('No records found in table_bookings');
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkTableStructure().catch(console.error);