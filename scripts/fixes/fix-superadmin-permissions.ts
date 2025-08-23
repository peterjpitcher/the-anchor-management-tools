import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

async function fixSuperadminPermissions() {
  console.log('🔧 Fixing superadmin permissions...\n');

  try {
    // Step 1: Ensure customers:manage permission exists
    console.log('1️⃣  Ensuring customers:manage permission exists...');
    const { data: existingPerm } = await supabase
      .from('permissions')
      .select('id')
      .eq('module_name', 'customers')
      .eq('action', 'manage')
      .single();

    let customersManagePermId;
    if (!existingPerm) {
      const { data: newPerm, error: permError } = await supabase
        .from('permissions')
        .insert({
          module_name: 'customers',
          action: 'manage',
          description: 'Manage customer labels and settings'
        })
        .select('id')
        .single();

      if (permError) {
        console.error('Error creating permission:', permError.message);
        return;
      }
      customersManagePermId = newPerm.id;
      console.log('✅ Created customers:manage permission');
    } else {
      customersManagePermId = existingPerm.id;
      console.log('✅ Permission already exists');
    }

    // Step 2: Get super_admin role
    console.log('\n2️⃣  Finding super_admin role...');
    const { data: superAdminRole, error: roleError } = await supabase
      .from('roles')
      .select('id, name')
      .eq('name', 'super_admin')
      .single();

    if (roleError || !superAdminRole) {
      console.error('Could not find super_admin role:', roleError?.message);
      return;
    }
    console.log('✅ Found super_admin role:', superAdminRole.id);

    // Step 3: Get all permissions
    console.log('\n3️⃣  Fetching all permissions...');
    const { data: allPermissions, error: permissionsError } = await supabase
      .from('permissions')
      .select('id, module_name, action');

    if (permissionsError || !allPermissions) {
      console.error('Could not fetch permissions:', permissionsError?.message);
      return;
    }
    console.log(`✅ Found ${allPermissions.length} total permissions`);

    // Step 4: Check existing role_permissions for super_admin
    console.log('\n4️⃣  Checking existing permissions for super_admin...');
    const { data: existingRolePerms, error: existingError } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', superAdminRole.id);

    if (existingError) {
      console.error('Error checking existing permissions:', existingError.message);
      return;
    }

    const existingPermIds = new Set(existingRolePerms?.map(rp => rp.permission_id) || []);
    const missingPermissions = allPermissions.filter(p => !existingPermIds.has(p.id));

    console.log(`📊 Super_admin has ${existingPermIds.size}/${allPermissions.length} permissions`);
    console.log(`📊 Missing ${missingPermissions.length} permissions`);

    // Step 5: Grant missing permissions
    if (missingPermissions.length > 0) {
      console.log('\n5️⃣  Granting missing permissions to super_admin...');
      
      const rolePermissionsToInsert = missingPermissions.map(p => ({
        role_id: superAdminRole.id,
        permission_id: p.id
      }));

      // Insert in batches to avoid timeout
      const batchSize = 10;
      for (let i = 0; i < rolePermissionsToInsert.length; i += batchSize) {
        const batch = rolePermissionsToInsert.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('role_permissions')
          .insert(batch);

        if (insertError) {
          console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError.message);
        } else {
          console.log(`✅ Granted ${batch.length} permissions (batch ${i / batchSize + 1})`);
        }
      }
    } else {
      console.log('\n✅ Super_admin already has all permissions!');
    }

    // Step 6: Verify customers:manage is granted
    console.log('\n6️⃣  Verifying customers:manage permission...');
    const { data: verifyPerm } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role_id', superAdminRole.id)
      .eq('permission_id', customersManagePermId)
      .single();

    if (verifyPerm) {
      console.log('✅ Confirmed: super_admin has customers:manage permission');
    } else {
      console.log('❌ Warning: customers:manage permission not found for super_admin');
    }

    console.log('\n🎉 Permission fixes completed!');
    console.log('\n📝 Summary:');
    console.log('- customers:manage permission exists');
    console.log('- super_admin role has been granted all permissions');
    console.log('- You should now see "Customer Labels" in settings');
    console.log('\n⚠️  Please refresh your browser to see the changes!');

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run the fix
fixSuperadminPermissions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });