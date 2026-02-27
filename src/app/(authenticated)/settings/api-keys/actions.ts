'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateApiKey as genKey, hashApiKey } from '@/lib/api/auth'
import { logAuditEvent } from '@/app/actions/audit'
import type { ApiKey } from '@/types/api'
import type { ActionType } from '@/types/rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'

type SettingsPermission = Extract<ActionType, 'view' | 'manage'>

type PermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

async function requireSettingsPermission(
  action: SettingsPermission,
): Promise<PermissionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'settings',
    p_action: action,
  })

  if (error) {
    console.error('Error verifying settings permissions:', error)
    return { error: 'Failed to verify permissions' }
  }

  if (data !== true) {
    return { error: 'Insufficient permissions' }
  }

  return { user, admin }
}

interface CreateApiKeyData {
  name: string;
  description: string;
  permissions: string[];
  rate_limit: number;
}

export async function getApiKeys(): Promise<{ data: ApiKey[] } | { error: string }> {
  const permission = await requireSettingsPermission('view')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { admin } = permission

  const { data, error } = await admin
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error loading API keys:', error)
    return { error: 'Failed to load API keys' }
  }

  return { data: (data ?? []) as ApiKey[] }
}

export async function generateApiKey(
  data: CreateApiKeyData,
): Promise<{ apiKey: ApiKey; plainKey: string } | { error: string }> {
  const permission = await requireSettingsPermission('manage')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { admin, user } = permission

  try {
    const plainKey = await genKey()
    const keyHash = await hashApiKey(plainKey)

    const { data: apiKey, error } = await admin
      .from('api_keys')
      .insert({
        key_hash: keyHash,
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
        rate_limit: data.rate_limit,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'api_key',
      resource_id: apiKey.id,
      operation_status: 'success',
      new_values: {
        name: apiKey.name,
        description: apiKey.description,
        permissions: apiKey.permissions,
        rate_limit: apiKey.rate_limit,
        is_active: apiKey.is_active,
      },
    })

    return { apiKey, plainKey }
  } catch (error) {
    console.error('Error creating API key:', error)
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'api_key',
      operation_status: 'failure',
      error_message: 'Failed to create API key',
      new_values: {
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
        rate_limit: data.rate_limit,
      },
    })
    return { error: 'Failed to create API key' }
  }
}

interface UpdateApiKeyData {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  rate_limit: number;
}

export async function updateApiKey(
  data: UpdateApiKeyData,
): Promise<{ success: true } | { error: string }> {
  const permission = await requireSettingsPermission('manage')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { admin, user } = permission

  try {
    const { data: existing, error: fetchError } = await admin
      .from('api_keys')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) return { error: 'API key not found' }

    const { error: updateError } = await admin
      .from('api_keys')
      .update({
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
        rate_limit: data.rate_limit,
      })
      .eq('id', data.id)

    if (updateError) throw updateError

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'api_key',
      resource_id: data.id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        description: existing.description,
        permissions: existing.permissions,
        rate_limit: existing.rate_limit,
      },
      new_values: {
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
        rate_limit: data.rate_limit,
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Error updating API key:', error)
    return { error: 'Failed to update API key' }
  }
}

export async function revokeApiKey(
  keyId: string,
): Promise<{ success: true } | { error: string }> {
  const permission = await requireSettingsPermission('manage')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { admin, user } = permission

  try {
    const { data: existing, error: fetchError } = await admin
      .from('api_keys')
      .select('*')
      .eq('id', keyId)
      .maybeSingle()

    if (fetchError) {
      throw fetchError
    }

    if (!existing) {
      return { error: 'API key not found' }
    }

    if (existing.is_active === false) {
      return { error: 'API key already revoked' }
    }

    const { data: updated, error: updateError } = await admin
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId)
      .select()
      .maybeSingle()

    if (updateError) {
      throw updateError
    }
    if (!updated) {
      return { error: 'API key not found' }
    }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'api_key',
      resource_id: keyId,
      operation_status: 'success',
      old_values: {
        is_active: existing.is_active,
      },
      new_values: {
        is_active: updated.is_active,
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Error revoking API key:', error)
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'api_key',
      resource_id: keyId,
      operation_status: 'failure',
      error_message: 'Failed to revoke API key',
    })
    return { error: 'Failed to revoke API key' }
  }
}
