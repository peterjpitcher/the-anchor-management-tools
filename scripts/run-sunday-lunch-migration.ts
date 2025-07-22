import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function runMigration() {
  console.log('Running Sunday lunch menu migration...');
  
  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20250719190000_add_sunday_lunch_menu_items.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Migration file found, executing SQL...');
    
    // Since we can't execute raw SQL directly, let's use the migration approach
    // First check if table exists
    const { error: checkError } = await supabase
      .from('sunday_lunch_menu_items')
      .select('count')
      .limit(1);
    
    if (checkError?.code === '42P01') {
      console.log('Table does not exist. Please run the migration manually using Supabase CLI or Dashboard.');
      console.log('\nRun this command:');
      console.log('supabase db push --include-all');
      console.log('\nOr apply the migration manually in the Supabase Dashboard SQL editor.');
      console.log('\nMigration file location:', migrationPath);
    } else if (!checkError) {
      console.log('Table already exists!');
      
      // Check if it has data
      const { data, error } = await supabase
        .from('sunday_lunch_menu_items')
        .select('*')
        .order('category')
        .order('display_order');
        
      if (error) {
        console.error('Error fetching data:', error);
      } else {
        console.log(`Found ${data?.length || 0} menu items.`);
        if (data && data.length === 0) {
          console.log('\nRun scripts/setup-sunday-lunch-menu.ts to populate initial data.');
        }
      }
    } else {
      console.error('Unexpected error:', checkError);
    }
    
  } catch (error) {
    console.error('Migration error:', error);
  }
}

runMigration().catch(console.error);