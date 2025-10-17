'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
import { logAuditEvent } from './audit';

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

type PermissionCheckResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>;

function normalizeRequiredTimestamp(value: unknown): string {
  if (typeof value === 'string' && value) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && value) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  return null;
}

function normalizeUserRecord(record: unknown): UserSummary | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const candidate = record as Record<string, any>;
  if (!candidate.id) {
    return null;
  }

  return {
    id: String(candidate.id),
    email:
      typeof candidate.email === 'string' || candidate.email === null
        ? candidate.email
        : candidate.email
          ? String(candidate.email)
          : null,
    created_at: normalizeRequiredTimestamp(candidate.created_at),
    last_sign_in_at: normalizeOptionalTimestamp(candidate.last_sign_in_at) ?? undefined,
  };
}

function isUserSummary(record: UserSummary | null): record is UserSummary {
  return record !== null;
}

async function requirePermission(moduleName: ModuleName, action: ActionType): Promise<PermissionCheckResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated' };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: moduleName,
    p_action: action,
  });

  if (error) {
    console.error('Permission check failed:', error);
    return { error: 'Failed to verify permissions' };
  }

  if (data !== true) {
    return { error: 'Insufficient permissions' };
  }

  return { user, admin };
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Not authenticated' };
  }

  const targetUserId = userId || user.id;

  if (targetUserId !== user.id) {
    const permission = await requirePermission('users', 'manage_roles');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { admin } = permission;

    const { data, error } = await admin
      .from('user_roles')
      .select('role_id')
      .eq('user_id', targetUserId);

    if (error) {
      console.error('Error fetching user roles for target user:', error);
      return { error: 'Failed to fetch roles' };
    }

    return { success: true, data: data || [] };
  }

  const { data, error } = await supabase.rpc('get_user_roles', {
    p_user_id: targetUserId,
  });

  if (error) {
    console.error('Error fetching user roles:', error);
    return { error: 'Failed to fetch roles' };
  }

  return { success: true, data: data || [] };
}

export async function getAllRoles() {
  const permission = await requirePermission('roles', 'view');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { admin } = permission;

  const { data, error } = await admin.from('roles').select('*').order('name');

  if (error) {
    console.error('Error fetching roles:', error);
    return { error: 'Failed to fetch roles' };
  }

  return { success: true, data: (data || []) as Role[] };
}

export async function getAllPermissions() {
  const permission = await requirePermission('roles', 'view');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { admin } = permission;

  const { data, error } = await admin
    .from('permissions')
    .select('*')
    .order('module_name, action');

  if (error) {
    console.error('Error fetching permissions:', error);
    return { error: 'Failed to fetch permissions' };
  }

  return { success: true, data: (data || []) as Permission[] };
}

export async function getRolePermissions(roleId: string) {
  const permission = await requirePermission('roles', 'view');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { admin } = permission;

  const { data, error } = await admin
    .from('role_permissions')
    .select('*, permissions(*)')
    .eq('role_id', roleId);

  if (error) {
    console.error('Error fetching role permissions:', error);
    return { error: 'Failed to fetch role permissions' };
  }

  return { success: true, data: data || [] };
}

export async function createRole(prevState: unknown, formData: FormData) {
  if (!formData) {
    return { error: 'No form data provided' };
  }

  const permission = await requirePermission('roles', 'manage');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { user, admin } = permission;

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

  const { data, error } = await admin
    .from('roles')
    .insert([{ name, description: description ?? null }])
    .select()
    .single();

  if (error) {
    console.error('Error creating role:', error);
    return { error: 'Failed to create role' };
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'create',
    resource_type: 'role',
    resource_id: data.id,
    operation_status: 'success',
    new_values: {
      name: data.name,
      description: data.description,
    },
  });

  revalidatePath('/roles');
  return { success: true, data };
}

export async function updateRole(prevState: unknown, formData: FormData) {
  const permission = await requirePermission('roles', 'manage');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { user, admin } = permission;

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

  const { data: existing, error: fetchError } = await admin
    .from('roles')
    .select('*')
    .eq('id', roleId)
    .maybeSingle();

  if (fetchError) {
    console.error('Error loading role before update:', fetchError);
    return { error: 'Failed to load role' };
  }

  if (!existing) {
    return { error: 'Role not found' };
  }

  if (existing.is_system) {
    return { error: 'System roles cannot be modified' };
  }

  const { data: updated, error } = await admin
    .from('roles')
    .update({ name, description: description ?? null })
    .eq('id', roleId)
    .select()
    .single();

  if (error) {
    console.error('Error updating role:', error);
    return { error: 'Failed to update role' };
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'update',
    resource_type: 'role',
    resource_id: roleId,
    operation_status: 'success',
    old_values: {
      name: existing.name,
      description: existing.description,
    },
    new_values: {
      name: updated?.name,
      description: updated?.description,
    },
  });

  revalidatePath('/roles');
  return { success: true };
}

export async function deleteRole(roleId: string) {
  const permission = await requirePermission('roles', 'manage');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { user, admin } = permission;

  const { data: existing, error: fetchError } = await admin
    .from('roles')
    .select('*')
    .eq('id', roleId)
    .maybeSingle();

  if (fetchError) {
    console.error('Error loading role before delete:', fetchError);
    return { error: 'Failed to load role' };
  }

  if (!existing) {
    return { error: 'Role not found' };
  }

  if (existing.is_system) {
    return { error: 'System roles cannot be deleted' };
  }

  const { error } = await admin.from('roles').delete().eq('id', roleId);

  if (error) {
    console.error('Error deleting role:', error);
    return { error: 'Failed to delete role' };
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'delete',
    resource_type: 'role',
    resource_id: roleId,
    operation_status: 'success',
    old_values: {
      name: existing.name,
      description: existing.description,
    },
  });

  revalidatePath('/roles');
  return { success: true };
}

export async function assignPermissionsToRole(roleId: string, permissionIds: string[]) {
  const permission = await requirePermission('roles', 'manage');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { user, admin } = permission;

  const { data: existing } = await admin
    .from('role_permissions')
    .select('permission_id')
    .eq('role_id', roleId);

  const { error: deleteError } = await admin
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
    
    const { error: insertError } = await admin
      .from('role_permissions')
      .insert(rolePermissions);
    
    if (insertError) {
      console.error('Error assigning permissions:', insertError);
      return { error: 'Failed to assign permissions' };
    }
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'update',
    resource_type: 'role_permissions',
    resource_id: roleId,
    operation_status: 'success',
    old_values: {
      permission_ids: (existing || []).map((item) => item.permission_id),
    },
    new_values: {
      permission_ids: permissionIds,
    },
  });
  
  revalidatePath('/roles');
  return { success: true };
}

export async function assignRolesToUser(userId: string, roleIds: string[]) {
  const permission = await requirePermission('users', 'manage_roles');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { user, admin } = permission;

  const { data: existing } = await admin
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);

  const { error: deleteError } = await admin
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
    
    const { error: insertError } = await admin
      .from('user_roles')
      .insert(userRoles);
    
    if (insertError) {
      console.error('Error assigning roles:', insertError);
      return { error: 'Failed to assign roles' };
    }
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'update',
    resource_type: 'user_roles',
    resource_id: userId,
    operation_status: 'success',
    old_values: {
      role_ids: (existing || []).map((record) => record.role_id),
    },
    new_values: {
      role_ids: roleIds,
    },
  });
  
  revalidatePath('/users');
  return { success: true };
}

export async function getAllUsers() {
  const permission = await requirePermission('users', 'view');
  if ('error' in permission) {
    return { error: permission.error };
  }

  const { admin, user: actingUser } = permission;

  try {
    const { data: rpcData, error: rpcError } = await admin.rpc('get_users_for_admin');
    if (rpcError) {
      console.warn('RPC get_users_for_admin failed, falling back to view:', rpcError);
    }

    if (Array.isArray(rpcData)) {
      const normalizedRpc = rpcData.map(normalizeUserRecord).filter(isUserSummary);
      if (normalizedRpc.length > 0) {
        return {
          success: true,
          data: normalizedRpc,
        };
      }
    }

    const { data: viewData, error: viewError } = await admin
      .from('admin_users_view')
      .select('id, email, created_at, last_sign_in_at')
      .order('created_at', { ascending: false });

    if (viewError) {
      console.warn('admin_users_view query failed, falling back to auth.admin.listUsers:', viewError);
    } else if (Array.isArray(viewData)) {
      const normalizedView = viewData.map(normalizeUserRecord).filter(isUserSummary);
      if (normalizedView.length > 0) {
        return {
          success: true,
          data: normalizedView,
        };
      }
    }

    const { data: authData, error: authError } = await admin.auth.admin.listUsers();
    if (authError) {
      console.error('Auth admin listUsers failed:', authError);
      const fallbackUser = normalizeUserRecord(actingUser);
      if (fallbackUser) {
        return { success: true, data: [fallbackUser] };
      }
      return { error: 'Unable to fetch users. Please run the user access migration.' };
    }

    if (!authData || !Array.isArray(authData.users)) {
      console.error('Auth admin listUsers returned no data.');
      const fallbackUser = normalizeUserRecord(actingUser);
      if (fallbackUser) {
        return { success: true, data: [fallbackUser] };
      }
      return { error: 'Failed to fetch users' };
    }

    const normalizedAuth = authData.users.map(normalizeUserRecord).filter(isUserSummary);

    // Preserve deterministic ordering (newest first) to match original UI expectations.
    normalizedAuth.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    return { success: true, data: normalizedAuth };
  } catch (error) {
    console.error('Error fetching users:', error);
    return { error: 'Failed to fetch users' };
  }
}
