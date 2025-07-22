import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function setupTableBookingsPermissions() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables. Please check your .env.local file.');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  console.log('Setting up table bookings permissions...');
  
  // First, check if the permissions already exist
  const { data: existingPermissions, error: checkError } = await supabase
    .from('permissions')
    .select('*')
    .eq('module_name', 'table_bookings');
    
  if (checkError) {
    console.error('Error checking permissions:', checkError);
    return;
  }
  
  if (existingPermissions && existingPermissions.length > 0) {
    console.log('Table bookings permissions already exist:', existingPermissions);
    
    // Check which roles have these permissions
    const { data: rolePermissions, error: roleError } = await supabase
      .from('role_permissions')
      .select(`
        *,
        role:roles(name),
        permission:permissions(module_name, action)
      `)
      .in('permission_id', existingPermissions.map(p => p.id));
      
    if (roleError) {
      console.error('Error checking role permissions:', roleError);
    } else {
      console.log('Role permissions:', rolePermissions);
    }
    
    return;
  }
  
  // Create the permissions if they don't exist
  const permissions = [
    { module_name: 'table_bookings', action: 'view', description: 'View table bookings' },
    { module_name: 'table_bookings', action: 'create', description: 'Create table bookings' },
    { module_name: 'table_bookings', action: 'edit', description: 'Edit table bookings' },
    { module_name: 'table_bookings', action: 'delete', description: 'Delete table bookings' },
    { module_name: 'table_bookings', action: 'manage', description: 'Manage table booking settings' },
  ];
  
  const { data: newPermissions, error: insertError } = await supabase
    .from('permissions')
    .insert(permissions)
    .select();
    
  if (insertError) {
    console.error('Error creating permissions:', insertError);
    return;
  }
  
  console.log('Created permissions:', newPermissions);
  
  // Now assign these permissions to roles
  // Get the roles
  const { data: roles, error: rolesError } = await supabase
    .from('roles')
    .select('*');
    
  if (rolesError) {
    console.error('Error fetching roles:', rolesError);
    return;
  }
  
  const roleMap = roles.reduce((acc, role) => {
    acc[role.name] = role.id;
    return acc;
  }, {} as Record<string, string>);
  
  console.log('Available roles:', Object.keys(roleMap));
  
  // Assign permissions to roles
  const rolePermissionsToInsert = [];
  
  // Super admin gets all permissions
  if (roleMap['super_admin']) {
    for (const perm of newPermissions!) {
      rolePermissionsToInsert.push({
        role_id: roleMap['super_admin'],
        permission_id: perm.id
      });
    }
  }
  
  // Manager gets all permissions
  if (roleMap['manager']) {
    for (const perm of newPermissions!) {
      rolePermissionsToInsert.push({
        role_id: roleMap['manager'],
        permission_id: perm.id
      });
    }
  }
  
  // Deputy gets all permissions (if role exists)
  if (roleMap['Deputy']) {
    for (const perm of newPermissions!) {
      rolePermissionsToInsert.push({
        role_id: roleMap['Deputy'],
        permission_id: perm.id
      });
    }
  }
  
  // Staff gets view, create, and edit permissions
  if (roleMap['staff']) {
    for (const perm of newPermissions!) {
      if (['view', 'create', 'edit'].includes(perm.action)) {
        rolePermissionsToInsert.push({
          role_id: roleMap['staff'],
          permission_id: perm.id
        });
      }
    }
  }
  
  if (rolePermissionsToInsert.length > 0) {
    const { error: assignError } = await supabase
      .from('role_permissions')
      .insert(rolePermissionsToInsert);
      
    if (assignError) {
      console.error('Error assigning permissions to roles:', assignError);
    } else {
      console.log(`Assigned ${rolePermissionsToInsert.length} permissions to roles`);
    }
  }
  
  console.log('\nTable bookings permissions setup complete!');
  console.log('\nSummary:');
  console.log(`- Created ${newPermissions?.length || 0} permissions`);
  console.log(`- Assigned to ${new Set(rolePermissionsToInsert.map(rp => rp.role_id)).size} roles`);
  console.log('\nYou should now see the Table Bookings option in the navigation menu.');
}

setupTableBookingsPermissions().catch(console.error);