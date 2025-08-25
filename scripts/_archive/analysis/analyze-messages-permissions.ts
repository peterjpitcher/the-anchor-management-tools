#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '.env.local' });
// Fallback to .env if .env.local doesn't have the required vars
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY)) {
  dotenv.config({ path: '.env' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function analyzeMessagesPermissions() {
  console.log('=== ANALYZING MESSAGES MODULE PERMISSIONS ===\n');

  try {
    // First, check if permissions table exists
    const { data: tableCheck, error: tableError } = await supabase
      .from('permissions')
      .select('*')
      .limit(1);

    if (tableError) {
      console.error('Error accessing permissions table:', tableError);
      
      // Try alternative table names
      console.log('\nChecking for alternative RBAC table names...');
      
      const { data: rbacPermCheck, error: rbacPermError } = await supabase
        .from('rbac_permissions')
        .select('*')
        .limit(1);
        
      if (!rbacPermError) {
        console.log('Found rbac_permissions table. Analyzing...');
        
        // Get all permissions for messages module
        const { data: messagePerms, error: msgError } = await supabase
          .from('rbac_permissions')
          .select('*')
          .eq('module_name', 'messages')
          .order('action');

        if (msgError) {
          console.error('Error fetching message permissions:', msgError);
        } else {
          console.log('\nMessage Module Permissions:');
          console.log('==========================');
          if (messagePerms && messagePerms.length > 0) {
            messagePerms.forEach(perm => {
              console.log(`- Action: ${perm.action}`);
              console.log(`  ID: ${perm.id}`);
              if (perm.description) {
                console.log(`  Description: ${perm.description}`);
              }
              console.log('');
            });
          } else {
            console.log('No permissions found for messages module.');
          }
        }

        // Check role permissions
        console.log('\nChecking which roles have message permissions...');
        const { data: rolePerms, error: rolePermError } = await supabase
          .from('rbac_role_permissions')
          .select(`
            role_id,
            permission_id,
            rbac_permissions!inner(module_name, action),
            rbac_roles!inner(name, description)
          `)
          .eq('rbac_permissions.module_name', 'messages');

        if (!rolePermError && rolePerms) {
          console.log('\nRoles with Message Permissions:');
          console.log('================================');
          
          const roleMap = new Map();
          rolePerms.forEach(rp => {
            const roleName = rp.rbac_roles?.name || rp.role_id;
            if (!roleMap.has(roleName)) {
              roleMap.set(roleName, []);
            }
            roleMap.get(roleName).push(rp.rbac_permissions?.action || 'unknown');
          });

          roleMap.forEach((actions, role) => {
            console.log(`\n${role}:`);
            actions.forEach(action => {
              console.log(`  - ${action}`);
            });
          });
        }
        
        return;
      }
    }

    // If we get here, we found the permissions table
    console.log('Found permissions table. Analyzing...');
    
    // Get all permissions for messages module
    const { data: messagePerms, error: msgError } = await supabase
      .from('permissions')
      .select('*')
      .eq('module_name', 'messages')
      .order('action');

    if (msgError) {
      console.error('Error fetching message permissions:', msgError);
    } else {
      console.log('\nMessage Module Permissions:');
      console.log('==========================');
      if (messagePerms && messagePerms.length > 0) {
        messagePerms.forEach(perm => {
          console.log(`- Action: ${perm.action}`);
          console.log(`  ID: ${perm.id}`);
          if (perm.description) {
            console.log(`  Description: ${perm.description}`);
          }
          console.log('');
        });
      } else {
        console.log('No permissions found for messages module.');
      }
    }

    // Check role permissions
    console.log('\nChecking which roles have message permissions...');
    const { data: rolePerms, error: rolePermError } = await supabase
      .from('role_permissions')
      .select(`
        role_id,
        permission_id,
        permissions!inner(module_name, action),
        roles!inner(name, description)
      `)
      .eq('permissions.module_name', 'messages');

    if (!rolePermError && rolePerms) {
      console.log('\nRoles with Message Permissions:');
      console.log('================================');
      
      const roleMap = new Map();
      rolePerms.forEach(rp => {
        const roleName = rp.roles?.name || rp.role_id;
        if (!roleMap.has(roleName)) {
          roleMap.set(roleName, []);
        }
        roleMap.get(roleName).push(rp.permissions?.action || 'unknown');
      });

      roleMap.forEach((actions, role) => {
        console.log(`\n${role}:`);
        actions.forEach(action => {
          console.log(`  - ${action}`);
        });
      });
    }

    // Check if there are any users with direct message permissions
    console.log('\n\nChecking for user role assignments...');
    const { data: userRoles, error: userRoleError } = await supabase
      .from('user_roles')
      .select(`
        user_id,
        roles!inner(name)
      `)
      .limit(10);

    if (!userRoleError && userRoles) {
      console.log(`\nFound ${userRoles.length} user role assignments (showing first 10)`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the analysis
analyzeMessagesPermissions().then(() => {
  console.log('\n=== ANALYSIS COMPLETE ===');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});