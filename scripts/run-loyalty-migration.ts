import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Starting loyalty program migration...\n');

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'complete-loyalty-migration-bulletproof.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Loaded migration file');
    console.log('⏳ Running migration...\n');

    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });

    if (error) {
      console.error('❌ Migration failed:', error.message);
      return;
    }

    console.log('✅ Migration completed successfully!\n');

    // Verify the migration
    console.log('🔍 Verifying migration...\n');

    // Check tables
    const { data: tables } = await supabase
      .rpc('exec_sql', {
        sql: `
          SELECT COUNT(*) as count 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN (
            'loyalty_programs', 'loyalty_tiers', 'loyalty_members',
            'loyalty_rewards', 'event_check_ins'
          )
        `
      });

    console.log(`📊 Loyalty tables created: ${tables?.[0]?.count || 0}/5 core tables`);

    // Check permissions
    const { data: permissions } = await supabase
      .from('permissions')
      .select('action')
      .eq('module_name', 'loyalty');

    console.log(`🔐 Loyalty permissions created: ${permissions?.length || 0} permissions`);
    if (permissions?.length) {
      console.log(`   Actions: ${permissions.map(p => p.action).join(', ')}`);
    }

    console.log('\n✨ Loyalty program migration complete!');
    console.log('\nNext steps:');
    console.log('1. Go to Settings > Loyalty Program Settings');
    console.log('2. Toggle "Enable Loyalty Program" to ON');
    console.log('3. Navigate to "VIP Club" in the menu to manage the program');

  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
}

// Note: If the exec_sql function doesn't exist, you'll need to run the SQL directly in Supabase
console.log('⚠️  Note: This script requires the exec_sql function to be available.');
console.log('If it fails, please run the migration directly in the Supabase SQL editor.\n');

runMigration();