import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
import { logAuditEvent } from '@/app/actions/audit'; // Audit logging will be in action, but helper types needed

// Role validation schemas
export const roleSchema = z.object({
  name: z.string()
    .min(1, 'Role name is required')
    .max(50, 'Role name too long')
    .regex(/^[a-zA-Z0-9_\s-]+$/, 'Role name can only contain letters, numbers, spaces, hyphens and underscores'),
  description: z.string()
    .max(500, 'Description too long')
    .optional()
});

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

export class PermissionService {
  static async checkUserPermission(
    moduleName: ModuleName,
    action: ActionType,
    userId: string
  ): Promise<boolean> {
    const supabase = createAdminClient(); // Use admin client for permission check, to avoid RLS issues

    const { data, error } = await supabase
      .rpc('user_has_permission', {
        p_user_id: userId,
        p_module_name: moduleName,
        p_action: action
      });
    
    if (error) {
      console.error('Error checking permission:', error);
      return false;
    }

    
    return data === true;
  }

  static async getUserPermissions(userId: string) {
    const supabase = createAdminClient();
    
    const { data, error } = await supabase
      .rpc('get_user_permissions', { p_user_id: userId });
    
    if (error) {
      console.error('Error fetching user permissions:', error);
      throw new Error('Failed to fetch permissions');
    }
    
    return data as UserPermission[];
  }

  static async getUserRoles(targetUserId: string, checkUserManagementPermission: boolean, actingUserId?: string) {
    const admin = createAdminClient();

    if (checkUserManagementPermission && actingUserId && targetUserId !== actingUserId) {
      // If a user is trying to get roles for another user, verify permission
      const hasPermission = await this.checkUserPermission('users', 'manage_roles', actingUserId);
      if (!hasPermission) {
        throw new Error('Insufficient permissions to manage user roles');
      }
    }

    const { data, error } = await admin
      .from('user_roles')
      .select('role_id')
      .eq('user_id', targetUserId);

    if (error) {
      console.error('Error fetching user roles for target user:', error);
      throw new Error('Failed to fetch roles');
    }

    return data || [];
  }
  
  static async getAllRoles() {
    const admin = createAdminClient();
    const { data, error } = await admin.from('roles').select('*').order('name');

    if (error) {
      console.error('Error fetching roles:', error);
      throw new Error('Failed to fetch roles');
    }
    return (data || []) as Role[];
  }

  static async getAllPermissions() {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('permissions')
      .select('*')
      .order('module_name, action');

    if (error) {
      console.error('Error fetching permissions:', error);
      throw new Error('Failed to fetch permissions');
    }
    return (data || []) as Permission[];
  }

  static async getRolePermissions(roleId: string) {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('role_permissions')
      .select('*, permissions(*)')
      .eq('role_id', roleId);

    if (error) {
      console.error('Error fetching role permissions:', error);
      throw new Error('Failed to fetch role permissions');
    }
    return data || [];
  }

  static async createRole(name: string, description?: string | null) {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('roles')
      .insert([{ name, description: description ?? null }])
      .select()
      .single();

    if (error) {
      console.error('Error creating role:', error);
      throw new Error('Failed to create role');
    }
    return data;
  }

  static async updateRole(roleId: string, name: string, description?: string | null) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Role not found');
    }

    if (existing.is_system) {
      throw new Error('System roles cannot be modified');
    }

    const { data: updated, error } = await admin
      .from('roles')
      .update({ name, description: description ?? null })
      .eq('id', roleId)
      .select()
      .single();

    if (error) {
      console.error('Error updating role:', error);
      throw new Error('Failed to update role');
    }
    return { updated, existing };
  }

  static async deleteRole(roleId: string) {
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error('Role not found');
    }

    if (existing.is_system) {
      throw new Error('System roles cannot be deleted');
    }

    const { error } = await admin.from('roles').delete().eq('id', roleId);

    if (error) {
      console.error('Error deleting role:', error);
      throw new Error('Failed to delete role');
    }
    return existing;
  }

  static async assignPermissionsToRole(roleId: string, permissionIds: string[]) {
    const admin = createAdminClient();

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
      throw new Error('Failed to update permissions');
    }
    
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
        throw new Error('Failed to assign permissions');
      }
    }
    return { oldPermissions: existing || [], newPermissions: permissionIds };
  }

  static async assignRolesToUser(userId: string, roleIds: string[], assignedByUserId: string) {
    const admin = createAdminClient();

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
      throw new Error('Failed to update user roles');
    }
    
    if (roleIds.length > 0) {
      const userRoles = roleIds.map(roleId => ({
        user_id: userId,
        role_id: roleId,
        assigned_by: assignedByUserId
      }));
      
      const { error: insertError } = await admin
        .from('user_roles')
        .insert(userRoles);
      
      if (insertError) {
        console.error('Error assigning roles:', insertError);
        throw new Error('Failed to assign roles');
      }
    }
    return { oldRoles: existing || [], newRoles: roleIds };
  }

  static async getAllUsers(actingUser: SupabaseUser) {
    const admin = createAdminClient();

    try {
      const { data: rpcData, error: rpcError } = await admin.rpc('get_users_for_admin');
      if (rpcError) {
        console.warn('RPC get_users_for_admin failed, falling back to view:', rpcError);
      }

      if (Array.isArray(rpcData)) {
        const normalizedRpc = rpcData.map(normalizeUserRecord).filter(isUserSummary);
        if (normalizedRpc.length > 0) {
          return normalizedRpc;
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
          return normalizedView;
        }
      }

      const { data: authData, error: authError } = await admin.auth.admin.listUsers();
      if (authError) {
        console.error('Auth admin listUsers failed:', authError);
        const fallbackUser = normalizeUserRecord(actingUser);
        if (fallbackUser) {
          return [fallbackUser];
        }
        throw new Error('Unable to fetch users. Please run the user access migration.');
      }

      if (!authData || !Array.isArray(authData.users)) {
        console.error('Auth admin listUsers returned no data.');
        const fallbackUser = normalizeUserRecord(actingUser);
        if (fallbackUser) {
          return [fallbackUser];
        }
        throw new Error('Failed to fetch users');
      }

      const normalizedAuth = authData.users.map(normalizeUserRecord).filter(isUserSummary);

      normalizedAuth.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

      return normalizedAuth;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw new Error('Failed to fetch users');
    }
  }
}
