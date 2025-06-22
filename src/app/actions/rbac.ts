'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';

// Role validation schemas
const roleSchema = z.object({
  name: z.string()
    .min(1, 'Role name is required')
    .max(50, 'Role name too long')
    .regex(/^[a-zA-Z0-9_\s-]+$/, 'Role name can only contain letters, numbers, spaces, hyphens and underscores'),
  description: z.string()
    .max(500, 'Description too long')
    .optional()
})

export async function getUserPermissions(userId?: string) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  
  const targetUserId = userId || user.id;
  
  const { data, error } = await supabase
    .rpc('get_user_permissions', { p_user_id: targetUserId });
  
  if (error) {
    console.error('Error fetching user permissions:', error);
    return { error: 'Failed to fetch permissions' };
  }
  
  return { success: true, data: data as UserPermission[] };
}

export async function checkUserPermission(
  moduleName: ModuleName,
  action: ActionType,
  userId?: string
): Promise<boolean> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  
  const targetUserId = userId || user.id;
  
  const { data, error } = await supabase
    .rpc('user_has_permission', {
      p_user_id: targetUserId,
      p_module_name: moduleName,
      p_action: action
    });
  
  if (error) {
    console.error('Error checking permission:', error);
    return false;
  }
  
  return data === true;
}

export async function getUserRoles(userId?: string) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  
  const targetUserId = userId || user.id;
  
  const { data, error } = await supabase
    .rpc('get_user_roles', { p_user_id: targetUserId });
  
  if (error) {
    console.error('Error fetching user roles:', error);
    return { error: 'Failed to fetch roles' };
  }
  
  return { success: true, data };
}

export async function getAllRoles() {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('name');
  
  if (error) {
    console.error('Error fetching roles:', error);
    return { error: 'Failed to fetch roles' };
  }
  
  return { success: true, data: data as Role[] };
}

export async function getAllPermissions() {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const { data, error } = await supabase
    .from('permissions')
    .select('*')
    .order('module_name, action');
  
  if (error) {
    console.error('Error fetching permissions:', error);
    return { error: 'Failed to fetch permissions' };
  }
  
  return { success: true, data: data as Permission[] };
}

export async function getRolePermissions(roleId: string) {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const { data, error } = await supabase
    .from('role_permissions')
    .select('*, permissions(*)')
    .eq('role_id', roleId);
  
  if (error) {
    console.error('Error fetching role permissions:', error);
    return { error: 'Failed to fetch role permissions' };
  }
  
  return { success: true, data };
}

export async function createRole(prevState: unknown, formData: FormData) {
  if (!formData) {
    return { error: 'No form data provided' };
  }

  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'manage');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  // Parse and validate form data
  const rawData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || undefined
  }

  const validationResult = roleSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const { name, description } = validationResult.data
  
  const { data, error } = await supabase
    .from('roles')
    .insert([{ name, description }])
    .select()
    .single();
  
  if (error) {
    console.error('Error creating role:', error);
    return { error: 'Failed to create role' };
  }
  
  revalidatePath('/roles');
  return { success: true, data };
}

export async function updateRole(prevState: unknown, formData: FormData) {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'manage');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const roleId = formData.get('roleId') as string;
  
  if (!roleId) {
    return { error: 'Role ID is required' };
  }

  // Parse and validate form data
  const rawData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || undefined
  }

  const validationResult = roleSchema.safeParse(rawData)
  if (!validationResult.success) {
    return { error: validationResult.error.errors[0].message }
  }

  const { name, description } = validationResult.data
  
  const { error } = await supabase
    .from('roles')
    .update({ name, description })
    .eq('id', roleId)
    .eq('is_system', false); // Prevent updating system roles
  
  if (error) {
    console.error('Error updating role:', error);
    return { error: 'Failed to update role' };
  }
  
  revalidatePath('/roles');
  return { success: true };
}

export async function deleteRole(roleId: string) {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'manage');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const { error } = await supabase
    .from('roles')
    .delete()
    .eq('id', roleId)
    .eq('is_system', false); // Prevent deleting system roles
  
  if (error) {
    console.error('Error deleting role:', error);
    return { error: 'Failed to delete role' };
  }
  
  revalidatePath('/roles');
  return { success: true };
}

export async function assignPermissionsToRole(roleId: string, permissionIds: string[]) {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('roles', 'manage');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  // First, remove all existing permissions for this role
  const { error: deleteError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId);
  
  if (deleteError) {
    console.error('Error removing permissions:', deleteError);
    return { error: 'Failed to update permissions' };
  }
  
  // Then, add the new permissions
  if (permissionIds.length > 0) {
    const rolePermissions = permissionIds.map(permissionId => ({
      role_id: roleId,
      permission_id: permissionId
    }));
    
    const { error: insertError } = await supabase
      .from('role_permissions')
      .insert(rolePermissions);
    
    if (insertError) {
      console.error('Error assigning permissions:', insertError);
      return { error: 'Failed to assign permissions' };
    }
  }
  
  revalidatePath('/roles');
  return { success: true };
}

export async function assignRolesToUser(userId: string, roleIds: string[]) {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('users', 'manage_roles');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  
  // First, remove all existing roles for this user
  const { error: deleteError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);
  
  if (deleteError) {
    console.error('Error removing user roles:', deleteError);
    return { error: 'Failed to update user roles' };
  }
  
  // Then, add the new roles
  if (roleIds.length > 0) {
    const userRoles = roleIds.map(roleId => ({
      user_id: userId,
      role_id: roleId,
      assigned_by: user.id
    }));
    
    const { error: insertError } = await supabase
      .from('user_roles')
      .insert(userRoles);
    
    if (insertError) {
      console.error('Error assigning roles:', insertError);
      return { error: 'Failed to assign roles' };
    }
  }
  
  revalidatePath('/users');
  return { success: true };
}

export async function getAllUsers() {
  const supabase = await createClient();
  
  const hasPermission = await checkUserPermission('users', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  try {
    // First, try the RPC function if it exists
    let { data: users, error: rpcError } = await supabase
      .rpc('get_users_for_admin');
    
    // If the secure function fails, try the view
    if (rpcError) {
      const { data: viewData, error: viewError } = await supabase
        .from('admin_users_view')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!viewError && viewData) {
        return { success: true, data: viewData };
      }
    }
    
    if (rpcError && !users) {
      // If RPC fails, try admin client as fallback
      const adminClient = createAdminClient();
      const { data: authData, error: authError } = await adminClient.auth.admin.listUsers();
      
      if (authError) {
        console.error('Failed to fetch users:', authError);
        // As a last resort, return the current user only
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          return {
            success: true,
            data: [{
              id: user.id,
              email: user.email || '',
              created_at: user.created_at || new Date().toISOString(),
              last_sign_in_at: user.last_sign_in_at || null
            }]
          };
        }
        return { error: 'Unable to fetch users. Please run the user access migration.' };
      }
      
      // Transform admin API data
      const users = authData.users.map(user => ({
        id: user.id,
        email: user.email || '',
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at
      }));
      
      return { success: true, data: users };
    }
    
    return { success: true, data: users || [] };
  } catch (error) {
    console.error('Error fetching users:', error);
    return { error: 'Failed to fetch users' };
  }
}