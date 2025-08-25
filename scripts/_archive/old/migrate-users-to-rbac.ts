#!/usr/bin/env node

/**
 * Migration script to assign default roles to existing users
 * 
 * Run this script after applying the RBAC migration to bootstrap the system
 * with at least one super admin user.
 * 
 * Usage:
 * 1. First, run the database migration in Supabase
 * 2. Then run: npx tsx scripts/migrate-users-to-rbac.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function migrateUsers() {
  console.log('Starting user migration to RBAC system...\n');

  try {
    // Get all users
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    
    if (usersError) {
      throw usersError;
    }

    if (!users || users.length === 0) {
      console.log('No users found to migrate');
      return;
    }

    console.log(`Found ${users.length} users to process\n`);

    // Get the super_admin role
    const { data: superAdminRole, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'super_admin')
      .single();

    if (roleError || !superAdminRole) {
      throw new Error('Super admin role not found. Make sure the RBAC migration has been run.');
    }

    // Get the staff role for other users
    const { data: staffRole, error: staffRoleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'staff')
      .single();

    if (staffRoleError || !staffRole) {
      throw new Error('Staff role not found. Make sure the RBAC migration has been run.');
    }

    // Sort users by creation date to assign super admin to the first user
    const sortedUsers = users.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Process each user
    for (let i = 0; i < sortedUsers.length; i++) {
      const user = sortedUsers[i];
      const isFirstUser = i === 0;
      const roleId = isFirstUser ? superAdminRole.id : staffRole.id;
      const roleName = isFirstUser ? 'super_admin' : 'staff';

      // Check if user already has a role
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('role_id')
        .eq('user_id', user.id)
        .single();

      if (existingRole) {
        console.log(`✓ User ${user.email} already has a role assigned`);
        continue;
      }

      // Assign role to user
      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({
          user_id: user.id,
          role_id: roleId,
          assigned_by: user.id // Self-assigned during migration
        });

      if (assignError) {
        console.error(`✗ Failed to assign role to ${user.email}:`, assignError.message);
      } else {
        console.log(`✓ Assigned ${roleName} role to ${user.email}${isFirstUser ? ' (First user - Super Admin)' : ''}`);
      }
    }

    console.log('\nMigration completed successfully!');
    console.log('\nIMPORTANT: The first user has been assigned the super_admin role.');
    console.log('This user can now manage roles and permissions for other users.');
    console.log('\nIf you need to change the super admin, you can do so through the UI');
    console.log('or by running SQL commands directly in Supabase.');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateUsers();