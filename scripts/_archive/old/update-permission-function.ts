import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

// Load environment variables
dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

async function updatePermissionFunction() {
  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    console.log('🔧 Updating user_has_permission function...\n');

    // Update the function
    const updateFunctionSQL = `
      CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
          -- First check if user is a superadmin
          IF EXISTS (
              SELECT 1
              FROM public.user_roles ur
              JOIN public.roles r ON ur.role_id = r.id
              WHERE ur.user_id = p_user_id
              AND r.name = 'super_admin'
          ) THEN
              RETURN true;
          END IF;
          
          -- Otherwise check specific permissions
          RETURN EXISTS (
              SELECT 1
              FROM public.user_roles ur
              JOIN public.role_permissions rp ON ur.role_id = rp.role_id
              JOIN public.permissions p ON rp.permission_id = p.id
              WHERE ur.user_id = p_user_id
              AND p.module_name = p_module_name
              AND p.action = p_action
          );
      END;
      $$;
    `;

    await client.query(updateFunctionSQL);
    console.log('✅ Updated user_has_permission function to grant superadmins full access');

    // Also create the helper function
    const helperFunctionSQL = `
      CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
          RETURN EXISTS (
              SELECT 1
              FROM public.user_roles ur
              JOIN public.roles r ON ur.role_id = r.id
              WHERE ur.user_id = p_user_id
              AND r.name = 'super_admin'
          );
      END;
      $$;
    `;

    await client.query(helperFunctionSQL);
    console.log('✅ Created is_super_admin helper function');

    // Remove the unused columns if they exist
    console.log('\n🔧 Checking for unused financial columns...');
    
    const checkColumnsSQL = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'employee_financial_details' 
      AND column_name IN ('sort_code_in_words', 'account_number_in_words');
    `;

    const { rows } = await client.query(checkColumnsSQL);
    
    if (rows.length > 0) {
      console.log(`Found ${rows.length} columns to remove`);
      
      for (const row of rows) {
        const dropColumnSQL = `ALTER TABLE employee_financial_details DROP COLUMN IF EXISTS ${row.column_name};`;
        await client.query(dropColumnSQL);
        console.log(`✅ Removed column: ${row.column_name}`);
      }
    } else {
      console.log('✅ No unused columns found');
    }

    console.log('\n🎉 All database updates completed successfully!');
    console.log('\n📝 Changes applied:');
    console.log('- user_has_permission function now grants superadmins full access');
    console.log('- is_super_admin helper function created');
    console.log('- Removed unused financial detail columns (if they existed)');
    console.log('\n⚠️  Please refresh your browser to see all changes!');

  } catch (error) {
    console.error('Error updating database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the update
updatePermissionFunction();