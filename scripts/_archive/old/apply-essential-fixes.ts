import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

async function applyFixes() {
  console.log('Applying essential fixes to the database...\n');

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'apply-essential-fixes.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: sqlContent
    }).single();

    if (error) {
      // If exec_sql doesn't exist, try a different approach
      console.log('Direct SQL execution not available, applying fixes individually...\n');
      
      // Fix 1: Update user_has_permission function
      console.log('1. Updating user_has_permission function...');
      const { error: funcError } = await supabase.rpc('update_function', {
        function_sql: `
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
        `
      });
      
      if (funcError) {
        console.log('Note: Function update might require manual execution');
      } else {
        console.log('✓ Function updated successfully');
      }

      // Fix 2: Check and remove columns
      console.log('\n2. Checking for unused columns...');
      const { data: columns } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'employee_financial_details')
        .in('column_name', ['sort_code_in_words', 'account_number_in_words']);

      if (columns && columns.length > 0) {
        console.log(`Found ${columns.length} columns to remove`);
        // Note: Direct ALTER TABLE might not work through Supabase client
        console.log('Note: Column removal might require manual execution');
      } else {
        console.log('✓ No unused columns found');
      }

      // Fix 3: Ensure customers:manage permission exists
      console.log('\n3. Ensuring customers:manage permission exists...');
      const { error: permError } = await supabase
        .from('permissions')
        .upsert({
          module_name: 'customers',
          action: 'manage',
          description: 'Manage customer labels and settings',
          created_at: new Date().toISOString()
        }, {
          onConflict: 'module_name,action'
        });

      if (permError) {
        console.log('Error creating permission:', permError.message);
      } else {
        console.log('✓ Permission ensured');
      }

      // Fix 4: Grant all permissions to superadmin
      console.log('\n4. Refreshing superadmin permissions...');
      
      // Get superadmin role
      const { data: role } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'super_admin')
        .single();

      if (role) {
        // Get all permissions
        const { data: permissions } = await supabase
          .from('permissions')
          .select('id');

        if (permissions) {
          // Create role_permissions entries
          const rolePermissions = permissions.map(p => ({
            role_id: role.id,
            permission_id: p.id,
            created_at: new Date().toISOString()
          }));

          const { error: rpError } = await supabase
            .from('role_permissions')
            .upsert(rolePermissions, {
              onConflict: 'role_id,permission_id',
              ignoreDuplicates: true
            });

          if (rpError) {
            console.log('Error updating role permissions:', rpError.message);
          } else {
            console.log(`✓ Granted ${permissions.length} permissions to superadmin`);
          }
        }
      }
    } else {
      console.log('✓ All fixes applied successfully!');
    }

    console.log('\n✅ Essential fixes process completed!');
    console.log('\nPlease verify:');
    console.log('1. You can now see "Customer Labels" in settings');
    console.log('2. Financial details save correctly for new employees');
    console.log('3. The employee list displays correctly');

  } catch (error) {
    console.error('Error applying fixes:', error);
    process.exit(1);
  }
}

// Run the fixes
applyFixes();