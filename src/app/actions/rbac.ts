'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin'; // Still needed for requirePermission helper
import { revalidatePath } from 'next/cache';
import { z } from 'zod'; // Zod still needed for form validation that's outside roleSchema
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
import { logAuditEvent } from './audit';
import { PermissionService, roleSchema } from '@/services/permission'; // Import service and schema

type PermissionCheckResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }; // Keep admin client for now, may be refactored away

type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>; // For getAllUsers result

// This helper is kept in the action as it authenticates the user and then uses the service to check permissions.
async function requirePermission(moduleName: ModuleName, action: ActionType): Promise<PermissionCheckResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated' };
  }

  const admin = createAdminClient(); // Still needed to pass to some service calls or for admin context

  const hasPermission = await PermissionService.checkUserPermission(moduleName, action, user.id);

  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  return { user, admin };
}

export async function getUserPermissions(userId?: string) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };
    
    const targetUserId = userId || user.id;

    if (targetUserId !== user.id) {
      const canManageUsers = await PermissionService.checkUserPermission('users', 'manage_roles', user.id);
      if (!canManageUsers) {
        return { error: 'Insufficient permissions to view other user permissions' };
      }
    }
    
    const permissions = await PermissionService.getUserPermissions(targetUserId);
    return { success: true, data: permissions as UserPermission[] };
  } catch (error: any) {
    console.error('Error fetching user permissions:', error);
    return { error: error.message || 'Failed to fetch permissions' };
  }
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

  if (targetUserId !== user.id) {
    const canManageUsers = await PermissionService.checkUserPermission('users', 'manage_roles', user.id);
    if (!canManageUsers) {
      return false;
    }
  }
  
  return await PermissionService.checkUserPermission(moduleName, action, targetUserId);
}

export async function getCurrentUserModuleActions(moduleName: ModuleName) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Not authenticated' as const };
    }

    const permissions = await PermissionService.getUserPermissions(user.id);

    const actions = (permissions || [])
      .filter((permission) => permission.module_name === moduleName)
      .map((permission) => permission.action);

    const uniqueActions = Array.from(new Set(actions));

    return { success: true as const, actions: uniqueActions };
  } catch (error: any) {
    console.error('Error fetching module permissions:', error);
    return { error: error.message || 'Failed to fetch permissions' };
  }
}

export async function getUserRoles(userId?: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Not authenticated' };
    }

    const targetUserId = userId || user.id;
    const checkUserManagementPermission = (targetUserId !== user.id);

    const roles = await PermissionService.getUserRoles(targetUserId, checkUserManagementPermission, user.id);
    return { success: true, data: roles || [] };
  } catch (error: any) {
    console.error('Error fetching user roles:', error);
    return { error: error.message || 'Failed to fetch roles' };
  }
}

export async function getAllRoles() {
  try {
    const permission = await requirePermission('roles', 'view');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const roles = await PermissionService.getAllRoles();
    return { success: true, data: roles };
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    return { error: error.message || 'Failed to fetch roles' };
  }
}

export async function getAllPermissions() {
  try {
    const permission = await requirePermission('roles', 'view');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const permissions = await PermissionService.getAllPermissions();
    return { success: true, data: permissions };
  } catch (error: any) {
    console.error('Error fetching permissions:', error);
    return { error: error.message || 'Failed to fetch permissions' };
  }
}

export async function getRolePermissions(roleId: string) {
  try {
    const permission = await requirePermission('roles', 'view');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const rolePermissions = await PermissionService.getRolePermissions(roleId);
    return { success: true, data: rolePermissions || [] };
  } catch (error: any) {
    console.error('Error fetching role permissions:', error);
    return { error: error.message || 'Failed to fetch role permissions' };
  }
}

export async function createRole(prevState: unknown, formData: FormData) {
  try {
    if (!formData) {
      return { error: 'No form data provided' };
    }

    const permission = await requirePermission('roles', 'manage');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user } = permission;

    const rawData = {
      name: formData.get('name') as string,
      description: formData.get('description') as string || undefined
    };

    const validationResult = roleSchema.safeParse(rawData);
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const { name, description } = validationResult.data;

    const newRole = await PermissionService.createRole(name, description);

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'role',
      resource_id: newRole.id,
      operation_status: 'success',
      new_values: {
        name: newRole.name,
        description: newRole.description,
      },
    });

    revalidatePath('/roles');
    return { success: true, data: newRole };
  } catch (error: any) {
    console.error('Error creating role:', error);
    return { error: error.message || 'Failed to create role' };
  }
}

export async function updateRole(prevState: unknown, formData: FormData) {
  try {
    const permission = await requirePermission('roles', 'manage');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user } = permission;

    const roleId = formData.get('roleId') as string;
    
    if (!roleId) {
      return { error: 'Role ID is required' };
    }

    const rawData = {
      name: formData.get('name') as string,
      description: formData.get('description') as string || undefined
    };

    const validationResult = roleSchema.safeParse(rawData);
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message };
    }

    const { name, description } = validationResult.data;

    const { updated, existing } = await PermissionService.updateRole(roleId, name, description);

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
  } catch (error: any) {
    console.error('Error updating role:', error);
    return { error: error.message || 'Failed to update role' };
  }
}

export async function deleteRole(roleId: string) {
  try {
    const permission = await requirePermission('roles', 'manage');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user } = permission;

    const deletedRole = await PermissionService.deleteRole(roleId);

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'delete',
      resource_type: 'role',
      resource_id: roleId,
      operation_status: 'success',
      old_values: {
        name: deletedRole.name,
        description: deletedRole.description,
      },
    });

    revalidatePath('/roles');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting role:', error);
    return { error: error.message || 'Failed to delete role' };
  }
}

export async function assignPermissionsToRole(roleId: string, permissionIds: string[]) {
  try {
    const permission = await requirePermission('roles', 'manage');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user } = permission;

    const { oldPermissions, newPermissions } = await PermissionService.assignPermissionsToRole(roleId, permissionIds);

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'role_permissions',
      resource_id: roleId,
      operation_status: 'success',
      old_values: {
        permission_ids: oldPermissions.map((item: any) => item.permission_id),
      },
      new_values: {
        permission_ids: newPermissions,
      },
    });
    
    revalidatePath('/roles');
    return { success: true };
  } catch (error: any) {
    console.error('Error assigning permissions:', error);
    return { error: error.message || 'Failed to assign permissions' };
  }
}

export async function assignRolesToUser(userId: string, roleIds: string[]) {
  try {
    const permission = await requirePermission('users', 'manage_roles');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user } = permission;

    const { oldRoles, newRoles } = await PermissionService.assignRolesToUser(userId, roleIds, user.id);

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'user_roles',
      resource_id: userId,
      operation_status: 'success',
      old_values: {
        role_ids: oldRoles.map((record: any) => record.role_id),
      },
      new_values: {
        role_ids: newRoles,
      },
    });
    
    revalidatePath('/users');
    return { success: true };
  } catch (error: any) {
    console.error('Error assigning roles:', error);
    return { error: error.message || 'Failed to assign roles' };
  }
}

export async function getAllUsers() {
  try {
    const permission = await requirePermission('users', 'view');
    if ('error' in permission) {
      return { error: permission.error };
    }

    const { user: actingUser } = permission;
    const users = await PermissionService.getAllUsers(actingUser);

    return { success: true, data: users };
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return { error: error.message || 'Failed to fetch users' };
  }
}
