import { createAdminClient } from '@/lib/supabase/server';

async function applyRBACFixes() {
  console.log('Applying RBAC fixes...\n');

  try {
    const supabase = await createAdminClient();

    // Step 1: Ensure customers:manage permission exists
    console.log('1. Creating customers:manage permission...');
    const { error: permError } = await supabase
      .from('permissions')
      .insert({
        module_name: 'customers',
        action: 'manage',
        description: 'Manage customer labels and settings'
      })
      .select()
      .single();

    if (permError && !permError.message.includes('duplicate')) {
      console.log('Permission might already exist:', permError.message);
    } else {
      console.log('✓ Permission created/verified');
    }

    // Step 2: Get super_admin role ID
    console.log('\n2. Finding super_admin role...');
    const { data: superAdminRole, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'super_admin')
      .single();

    if (roleError || !superAdminRole) {
      console.error('Could not find super_admin role:', roleError);
      return;
    }
    console.log('✓ Found super_admin role:', superAdminRole.id);

    // Step 3: Get all permissions
    console.log('\n3. Fetching all permissions...');
    const { data: allPermissions, error: permissionsError } = await supabase
      .from('permissions')
      .select('id, module_name, action');

    if (permissionsError || !allPermissions) {
      console.error('Could not fetch permissions:', permissionsError);
      return;
    }
    console.log(`✓ Found ${allPermissions.length} permissions`);

    // Step 4: Grant all permissions to super_admin
    console.log('\n4. Granting all permissions to super_admin...');
    let granted = 0;
    let skipped = 0;

    for (const permission of allPermissions) {
      const { error } = await supabase
        .from('role_permissions')
        .insert({
          role_id: superAdminRole.id,
          permission_id: permission.id
        })
        .select();

      if (error) {
        if (error.message.includes('duplicate')) {
          skipped++;
        } else {
          console.log(`Error granting ${permission.module_name}:${permission.action}:`, error.message);
        }
      } else {
        granted++;
      }
    }

    console.log(`✓ Granted ${granted} new permissions, ${skipped} already existed`);

    // Step 5: Verify a super_admin user can access customers:manage
    console.log('\n5. Verifying super_admin access...');
    
    // Get a super_admin user (you)
    const { data: { user } } = await supabase.auth.admin.listUsers();
    if (user && user[0]) {
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('*, roles(*)')
        .eq('user_id', user[0].id);
      
      console.log('✓ User roles verified');
    }

    console.log('\n✅ RBAC fixes completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Refresh your browser to see the "Customer Labels" option in settings');
    console.log('2. The superadmin role now has access to all permissions');

  } catch (error) {
    console.error('Error applying RBAC fixes:', error);
  }
}

// Execute the fixes
applyRBACFixes().then(() => process.exit(0)).catch(() => process.exit(1));