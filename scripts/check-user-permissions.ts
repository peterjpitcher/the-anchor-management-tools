import { createClient } from '../src/lib/supabase/server';

async function checkUserPermissions() {
  const supabase = await createClient();
  
  console.log('=== CHECKING USER PERMISSIONS ===\n');
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    console.log('❌ No authenticated user found');
    return;
  }
  
  console.log(`User ID: ${user.id}`);
  console.log(`Email: ${user.email}\n`);
  
  // Get user's role assignments
  const { data: roleAssignments } = await supabase
    .from('user_role_assignments')
    .select(`
      role:rbac_roles(
        name,
        role_permissions:rbac_role_permissions(
          permission:rbac_permissions(
            module,
            action
          )
        )
      )
    `)
    .eq('user_id', user.id);
    
  if (!roleAssignments || roleAssignments.length === 0) {
    console.log('❌ No role assignments found for user');
    return;
  }
  
  console.log('Roles and Permissions:');
  roleAssignments.forEach(assignment => {
    console.log(`\nRole: ${assignment.role?.name}`);
    
    const permissions = assignment.role?.role_permissions || [];
    const messagePermissions = permissions.filter(p => 
      p.permission?.module === 'messages'
    );
    
    if (messagePermissions.length > 0) {
      console.log('  Messages module permissions:');
      messagePermissions.forEach(p => {
        console.log(`    - ${p.permission?.action}`);
      });
    } else {
      console.log('  ❌ No messages module permissions');
    }
  });
  
  // Check specific permission
  console.log('\n=== CHECKING SPECIFIC PERMISSIONS ===');
  
  const { data: hasManagePermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module: 'messages',
    p_action: 'manage'
  });
  
  console.log(`\nmessages.manage permission: ${hasManagePermission ? '✅ YES' : '❌ NO'}`);
  
  const { data: hasViewPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module: 'sms_health',
    p_action: 'view'
  });
  
  console.log(`sms_health.view permission: ${hasViewPermission ? '✅ YES' : '❌ NO'}`);
  
  if (!hasManagePermission) {
    console.log('\n⚠️  You need the "messages.manage" permission to see the Twilio Messages Monitor page');
  }
  
  process.exit(0);
}

checkUserPermissions().catch(console.error);